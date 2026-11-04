# Arquitetura

A função faz **uma** coisa: recebe da fila um e-mail já escrito, confere a
mensagem e entrega o e-mail por SMTP. O código é organizado para que as regras
da mensagem sejam testáveis sem fila nem servidor de e-mail, e para que trocar a
forma de receber a mensagem ou a biblioteca de envio não exija mexer nessas
regras.

## Camadas

O código segue Clean Architecture, como os serviços da solução: ele é dividido
em camadas, e uma camada só pode depender das camadas **mais internas** que ela.
As regras ficam no centro; os detalhes técnicos (AWS, SMTP, log, spans) ficam na
borda.

```
┌─────────────────────────────────────────────────────────────┐
│ infrastructure/                                             │
│   serverless/ smtp/ config/ logging/ telemetry/             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ interface-adapters/  (SendEmailController)            │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │ application/  (caso de uso, portas, eventos)    │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │ domain/  (EmailMessage, catálogo de       │  │  │  │
│  │  │  │           mensagens, exceções)            │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

| Camada | O que contém | O que **não** pode |
| --- | --- | --- |
| `domain` | `EmailMessage`, o objeto que representa um e-mail válido: ao menos um destinatário, cada um um endereço só, assunto, texto e HTML preenchidos. Também o tipo de `notification.email.send`, copiado do catálogo de mensagens do Work Order. | Conhecer fila, SMTP, AWS ou log. |
| `application` | O caso de uso `SendEmailUseCase` — a operação "enviar um e-mail" —, as interfaces (portas) de que ele precisa e o catálogo de eventos de log. | Importar biblioteca de infraestrutura. |
| `interface-adapters` | `SendEmailController`: chama o caso de uso e traduz o resultado em "enviado" ou "falhou, por tal motivo". Não depende de framework. | Importar biblioteca de infraestrutura ou conhecer o formato do evento da AWS Lambda. |
| `infrastructure` | Ler a mensagem da fila, enviar por SMTP, ler a configuração, escrever o log e montar o envio dos spans (ver abaixo). É o **único** lugar que conhece a AWS Lambda, junto do ponto de entrada `handler.ts`. | — |

Um **span** é o registro de uma etapa dentro de um **trace**, o caminho de um
pedido entre os serviços. A função registra um span por mensagem, filho do span
do serviço que pediu o e-mail, e o envia por OTLP (o protocolo de envio do
OpenTelemetry) à Datadog Extension, a extensão do Datadog anexada à função — ver
[Observabilidade](observability.md#o-span-de-cada-mensagem). O contexto do trace
chega no atributo `traceparent` da mensagem e é lido pelo propagador W3C, o
componente do OpenTelemetry que converte esse atributo em contexto e recusa o
que foge do padrão W3C Trace Context. A pasta
`infrastructure/telemetry/` só monta o SDK do OpenTelemetry (a biblioteca de
telemetria de padrão aberto que os serviços também usam) e envia os spans; quem
abre e fecha o span de cada mensagem é o ponto de entrada (ver
[Ponto de entrada fino](#ponto-de-entrada-fino)).

### Regras de importação verificadas pelo lint

As fronteiras entre camadas não dependem só de disciplina: o
`app/eslint.config.mjs` tem três regras que fazem o `npm run lint` falhar quando
são quebradas.

- `domain/` e `application/` não podem importar `aws-lambda`, `nodemailer`,
  `pino`, os pacotes do OpenTelemetry (`@opentelemetry/*`) nem arquivos de
  `infrastructure/` ou `interface-adapters/`.
- `interface-adapters/` não pode importar `aws-lambda`, `nodemailer`, `pino`, os
  pacotes do OpenTelemetry nem arquivos de `infrastructure/`.
- Os tipos do evento da AWS Lambda (`aws-lambda`) só podem ser importados em
  `src/infrastructure/serverless/` e em `src/handler.ts`, o ponto de entrada.

A mensagem de erro do lint, em português, diz qual regra foi quebrada.

## Portas

Uma porta é uma interface declarada pela camada interna e implementada pela
externa. Assim o caso de uso depende de "algo que envia e-mail", e não do
`nodemailer`.

| Porta | Onde fica | Implementação |
| --- | --- | --- |
| `ISendEmailUseCase` | `application/ports/input/notification/` | `SendEmailUseCase` |
| `IEmailSender` | `application/ports/output/` | `SmtpEmailSender`, sobre o `nodemailer` |
| `ILogger` | `application/ports/output/` | `PinoLoggerAdapter`, sobre o `pino` |

O caso de uso recebe os dados do e-mail (`SendEmailInputDto`), cria o
`EmailMessage` — que recusa dados inválidos — e o entrega a `IEmailSender`. Ele
não conhece o formato da mensagem da fila. Quem confere a mensagem contra o tipo
de `notification.email.send` é o leitor da fila,
`infrastructure/serverless/notification-message.parser.ts`, com um schema `zod`
amarrado ao tipo copiado do catálogo: se o tipo mudar, o código deixa de
compilar.

Nos testes unitários, o caso de uso recebe uma implementação falsa de
`IEmailSender`: nada de fila nem de rede.

## Montagem das dependências

A AWS Lambda não cria um processo novo a cada execução. Ela mantém um **ambiente
de execução** — um contêiner com o processo Node.js já carregado — e o reaproveita
nas execuções seguintes enquanto houver mensagens. Por isso os objetos da função
(configuração, cliente SMTP, caso de uso, controller e envio de spans) são
montados **uma vez por ambiente** e guardados em memória por
`app/src/bootstrap.ts`.

A montagem é **síncrona**: não há segredo a buscar nem conexão a abrir antes da
primeira mensagem. O `nodemailer` só abre a conexão SMTP na hora do envio.

```
getDependencies()  ─┬─ já montado? devolve os mesmos objetos
                    │
                    └─ primeira vez:
                       loadEnvironment()        → variável inválida → registra app.configuration.invalid
                       SmtpEmailSender.create() → cliente SMTP com limites de 2 s
                       new SendEmailUseCase(...)
                       new SendEmailController(...)
                       createTracing()          → envio de spans; sem OTEL_EXPORTER_OTLP_ENDPOINT, um que não faz nada
```

Se a montagem falhar, ela **não** fica guardada: a execução seguinte tenta montar
de novo. A falha registra no log `app.configuration.invalid` (variável de
ambiente ausente ou inválida) ou `app.initialization.failed` (qualquer outra
causa) e faz a execução falhar; todas as mensagens recebidas voltam à fila. O
logger usado nesse registro é criado fora da montagem, justamente para existir
quando ela falha.

`createTracing()` é a exceção: uma falha ao montar o envio de spans **não**
derruba a montagem. Ela escreve a linha `telemetry failure` com o estágio
`startup` na saída de erro (stderr) — ver
[Logging](logging.md#falhas-do-log-e-da-telemetria-no-stderr) — e a função segue
sem spans, enviando os e-mails normalmente.

## Fluxo de uma execução

```
evento da AWS Lambda com as mensagens da fila (uma, pelo event source mapping)
  │
  ├─ getDependencies()   (fora de qualquer try) ── falha → execução falha, mensagens voltam à fila
  ├─ atributos da execução (id, função, versão, memória, região)
  │
  ├─ para cada mensagem, em ordem:
  │    ├─ uma mensagem anterior do mesmo grupo falhou nesta execução?
  │    │     → devolve sem tentar, sem log e sem span
  │    │
  │    ├─ lê os atributos traceparent e tracestate (propagador W3C)
  │    │     → o mesmo contexto é o pai do span e a origem do trace_id do log
  │    ├─ abre o span "process notification.fifo", antes de ler o corpo
  │    │
  │    ├─ parseNotificationMessage(body)
  │    │     ├─ não é JSON, envelope inválido ou outro tipo ── falha → notification.failed (invalid_message)
  │    │     ├─ lê o purpose, mesmo que o resto do payload seja inválido
  │    │     └─ payload fora do schema                     ── falha → notification.failed (invalid_message)
  │    │
  │    ├─ id da mensagem e id da OS → no span e no logger, que leva também a fila e o trace_id
  │    │
  │    ├─ controller.send(payload)
  │    │     └─ caso de uso → EmailMessage.create() ── dados inválidos → invalid_message
  │    │                    → SmtpEmailSender.send() ── erro SMTP      → smtp_error
  │    │
  │    ├─ enviado → notification.sent
  │    ├─ falhou  → notification.failed (retry ou dead_lettered) e marca o grupo como falho
  │    ├─ grava no span o propósito, o resultado e, na falha, o motivo (error.type)
  │    └─ fecha o span, também quando algo lança uma exceção
  │
  ├─ espera o envio dos spans à extensão do Datadog (até 500 ms), também quando algo lança
  │     └─ falha ou demora → linha telemetry failure (export) no stderr; a resposta não muda
  │
  └─ responde { batchItemFailures: [ids das mensagens que falharam] }
```

**Uma linha de log por mensagem tentada:** `notification.sent` ou
`notification.failed`. Quem a escreve é o ponto de entrada, que conhece a
mensagem inteira; o caso de uso só envia ou lança uma exceção.

**Envio antes da resposta.** Logo depois da resposta, a AWS Lambda pode congelar
o ambiente de execução até a próxima mensagem, e um span ainda não enviado
ficaria parado. Por isso a função espera o envio antes de responder, uma vez por
execução. O span só é registrado quando a mensagem traz um contexto de trace
válido e amostrado (o serviço que abriu o trace decidiu registrá-lo); nos
outros casos, abri-lo e fechá-lo não faz nada — ver
[Observabilidade](observability.md#o-span-de-cada-mensagem).

## Ponto de entrada fino

`app/src/handler.ts` é a função que a AWS Lambda chama. Ele obtém as
dependências, percorre as mensagens e monta a resposta. Não tem regra do e-mail,
não monta dependências e não fala SMTP. Ele **conta** na cobertura de testes,
porque contém a regra de ordem por grupo e a escolha entre `retry` e
`dead_lettered`.

Ele também abre e fecha o span de cada mensagem, em duas funções privadas: uma
lê o contexto do trace nos atributos da mensagem e abre o span; a outra grava o
resultado, só com os campos permitidos no span. O span fica aqui porque o ponto
de entrada já conhece o formato da mensagem da fila, o id dela, o id da OS e o
resultado: pela regra de importação, só ele e `infrastructure/serverless/`
conhecem o formato do evento da AWS Lambda. O id da mensagem e o da OS são
montados uma vez e usados pelo log e pelo span, que assim não divergem.

## Pastas

```
.
├── app/                     código e toda a configuração da função
│   ├── src/
│   │   ├── domain/
│   │   │   ├── exceptions/
│   │   │   ├── messaging/         notification.messages.ts (cópia do catálogo do Work Order)
│   │   │   └── value-objects/     email-message.vo.ts
│   │   ├── application/
│   │   │   ├── logging/           definição dos eventos e dos campos de log
│   │   │   ├── ports/input|output/
│   │   │   └── use-cases/notification/  send-email.use-case.ts
│   │   ├── interface-adapters/notification/  send-email.controller.ts
│   │   ├── infrastructure/
│   │   │   ├── config/            leitura das variáveis de ambiente
│   │   │   ├── exceptions/
│   │   │   ├── logging/           campos permitidos, ocultação de dados, adaptador do pino
│   │   │   ├── serverless/        leitura da mensagem da fila
│   │   │   ├── smtp/              smtp-email-sender.ts
│   │   │   └── telemetry/         montagem do SDK do OpenTelemetry, envio dos spans e linha telemetry failure
│   │   ├── bootstrap.ts           montagem das dependências
│   │   └── handler.ts             ponto de entrada e span de cada mensagem
│   ├── test/{unit,e2e,helpers}/
│   ├── localstack/                criação de tópico e filas para os testes de ponta a ponta
│   ├── scripts/                   build e execução local
│   ├── events/                    mensagem de exemplo para execução local
│   └── package.json  tsconfig.json  jest*.config.ts  eslint.config.mjs  sonar-project.properties
├── docs/                    esta documentação e os ADRs
├── infra/                   Terraform: função, rede, log e ligação com a fila
└── .github/                 workflows de CI, análise estática e entrega
```

A raiz **não** tem `package.json` nem configuração de build, teste ou lint: tudo
isso fica em `app/`, como nos serviços e na customer-auth.

## Aliases de importação

O código importa por atalhos — `@domain`, `@application`, `@interface-adapters`
e `@infrastructure` — declarados no `paths` do `tsconfig.json`. O `esbuild`
troca os atalhos pelos caminhos reais ao gerar o pacote, e `app/scripts/build.ts`
**falha o build** se algum atalho sobrar no arquivo gerado: um atalho que
sobrasse só quebraria quando a função publicada fosse executada.

O Jest não lê o `tsconfig.json`, então declara o mesmo mapa em
`jest.config.ts`; o `jest.e2e.config.ts` importa esse mapa em vez de repeti-lo.

## Como a função roda na AWS

![Infraestrutura: o tópico SNS oficina-events.fifo copia a mensagem para a fila SQS notification.fifo, que manda à DLQ notification-dlq.fifo após 5 recebimentos; o event source mapping entrega uma mensagem por execução, com até 10 execuções simultâneas, à função nas subnets privadas, que envia o e-mail pelo NLB interno na porta 1025 ao MailHog no namespace platform; logs no CloudWatch com retenção de 14 dias](diagrams/infrastructure.png)

**Quem chama a função.** Um *event source mapping* — a configuração da AWS
Lambda que lê uma fila SQS e executa a função com as mensagens — liga
`notification.fifo` à função. Ele entrega uma mensagem por execução, com até 10
execuções ao mesmo tempo, e aceita a resposta parcial `batchItemFailures`. É a
AWS que lê a fila e apaga as mensagens confirmadas: a função não chama a SQS.

**Rede.** A função roda nas subnets privadas da VPC da solução, com um security
group próprio que não aceita conexão de entrada — ninguém conecta na função — e
libera a saída. Pela saída ela alcança a porta 1025 do balanceador de carga de
rede (NLB) interno, que repassa a conexão ao MailHog no namespace `platform` do
cluster Kubernetes, e o Datadog, para onde vão os logs.

**Limites de tempo.** A execução tem no máximo 5 s; o envio SMTP tem no máximo 2
s para conectar, 2 s para a saudação do servidor e 2 s sem resposta durante o
envio. O *visibility timeout* da fila — o tempo em que uma mensagem entregue fica
invisível para outra execução — é 30 s, seis vezes o limite da função, como a
AWS recomenda.

**Execuções simultâneas.** A função não tem concorrência reservada (uma cota da
conta separada só para ela). O limite de 10 execuções ao mesmo tempo é do event
source mapping, que só segura a leitura da fila, sem recusar execuções — ver
[ADR 0002](adr/0002-uma-mensagem-por-invocacao.md).

Detalhes dos recursos em [Infraestrutura](terraform.md).

## Diferenças em relação à customer-auth

A customer-auth (`oficina-mecanica-lambda-customer-auth`) é a outra função
Lambda da solução: autentica clientes por CPF e senha e é chamada pelo API
Gateway. Ela serviu de modelo para este repositório, e as diferenças abaixo são
intencionais.

| Na customer-auth | Aqui | Por quê |
| --- | --- | --- |
| Chamada pelo API Gateway, responde HTTP | Chamada pelo event source mapping, responde `batchItemFailures` | O pedido chega pela fila |
| Montagem das dependências assíncrona, iniciada na carga do módulo | Síncrona, na primeira mensagem | Não há segredo nem conexão a preparar |
| Presenter e corpo de resposta HTTP | Só o controller | A resposta é a lista de falhas, montada pelo ponto de entrada |
| Uma linha de log por requisição, com `request.id` e durações | Um evento por mensagem, com `trace_id` e o id da mensagem | A unidade de trabalho é a mensagem, e o pedido já traz o trace de quem o fez |
| Concorrência reservada | Limite no event source mapping, sem reserva | Uma reserva menor que o limite do mapping recusaria execuções e empurraria mensagens para a DLQ |
| Sem trace: nenhum span, e a correlação é pelo id recebido do API Gateway (`request.id`) | Um span por mensagem, filho do span de quem pediu o e-mail, enviado à Datadog Extension por OTLP | O pedido chega com o trace do serviço que o fez, e o span mostra o envio do e-mail dentro desse trace — ver [ADR 0004](adr/0004-span-de-processamento-por-mensagem.md) |
| `pg`, `jose`, `bcryptjs` e o cliente do Secrets Manager | `nodemailer` e o SDK do OpenTelemetry | A função não lê banco nem segredo, e envia spans |
| Camadas, código de logging e empacotamento | **Os mesmos**, com duas diferenças: o canal de diagnóstico no stderr segue o do Work Order e escreve também a linha `telemetry failure`; e o arquivo único do pacote leva o OpenTelemetry dentro | Ver [ADR 0003](adr/0003-camadas-enxutas-e-empacotamento.md) e [Logging](logging.md#origem-do-código-copiado) |
