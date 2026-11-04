<div align="center">

# ✉️ Oficina Mecânica · Notification

**Envio de e-mails da solução, em uma função AWS Lambda.** Os serviços pedem um
e-mail por mensagem na fila; a função confere a mensagem e entrega o e-mail por
SMTP, sem gravar o conteúdo dele em log.

![Node](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![AWS Lambda](https://img.shields.io/badge/AWS%20Lambda-FF9900?logo=awslambda&logoColor=white)
![Cobertura](https://img.shields.io/badge/cobertura-100%25-brightgreen)

[![CI](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/actions/workflows/ci.yml/badge.svg)](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/actions/workflows/ci.yml)
[![SAST](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/actions/workflows/sast.yml/badge.svg)](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/actions/workflows/sast.yml)
[![CD](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/actions/workflows/cd.yml/badge.svg)](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/actions/workflows/cd.yml)

</div>

## 📋 Sobre

Projeto acadêmico da pós-graduação em Arquitetura de Software da FIAP (turma
15SOAT), parte do ecossistema da **Oficina Mecânica**.

A solução tem serviços separados por responsabilidade — o Identity cuida de
usuários e acessos, o Work Order cuida das ordens de serviço (OS) — e alguns
deles precisam mandar e-mails: a senha inicial de um funcionário recém-cadastrado,
o aviso de que um orçamento está pronto para o cliente aprovar.

Nenhum desses serviços fala SMTP, o protocolo de envio de e-mail. Quando um deles
precisa mandar um e-mail, publica uma mensagem do tipo `notification.email.send`
no tópico de eventos da solução (`oficina-events.fifo`, no Amazon SNS). O tópico
copia a mensagem para a fila `notification.fifo` (Amazon SQS), e esta função lê a
fila e envia o e-mail.

Hoje o destino dos e-mails é o **MailHog**, um servidor SMTP de teste que roda no
cluster Kubernetes da solução: ele aceita os e-mails e os mostra numa caixa de
entrada web, sem entregá-los a endereços reais.

![Infraestrutura: o tópico SNS oficina-events.fifo copia a mensagem para a fila SQS notification.fifo, que manda à DLQ notification-dlq.fifo após 5 recebimentos; o event source mapping entrega uma mensagem por execução, com até 10 execuções simultâneas, à função nas subnets privadas, que envia o e-mail pelo NLB interno na porta 1025 ao MailHog no namespace platform; logs no CloudWatch e, com a layer opcional do Datadog, no Datadog](docs/diagrams/infrastructure.png)

## 🎯 Responsabilidade

**O que a função faz**

- Lê os pedidos de e-mail da fila SQS `notification.fifo`, uma mensagem por vez.
- Confere cada mensagem antes de enviar: o formato do envelope (a parte comum a
  todas as mensagens da solução) e, no conteúdo, se há ao menos um destinatário
  válido e se assunto, texto e HTML estão preenchidos.
- Envia por SMTP o e-mail exatamente como o recebeu, com o remetente configurado
  na função.
- Grava no log um registro por mensagem: o evento `notification.sent` quando o
  servidor SMTP aceita o e-mail, ou o evento `notification.failed` quando ele
  recusa ou a mensagem é inválida. O registro diz que tipo de e-mail era, de qual
  ordem de serviço e de qual pedido veio — **nunca** o conteúdo do e-mail.

**O que ela não faz**

- Não escreve e-mails: não tem modelos (templates), não escolhe texto nem idioma.
  O serviço que pede o e-mail já o envia pronto, com destinatários, assunto, texto
  e HTML.
- Não guarda quais e-mails já enviou, não chama outros serviços e não acessa
  banco de dados.
- Não avisa o serviço que pediu se o e-mail saiu ou falhou.

**Duas garantias**

- **Uma falha de e-mail nunca desfaz a operação de negócio.** Quando o serviço
  publica o pedido de e-mail, a operação dele (cadastrar o funcionário, enviar o
  orçamento) já está concluída. Um e-mail que falha volta para a fila e é tentado
  de novo; depois de cinco tentativas sem sucesso, a mensagem vai para a fila
  `notification-dlq.fifo` — a DLQ (*dead-letter queue*), onde mensagens que não
  puderam ser processadas ficam guardadas para análise.
- **Cada e-mail é entregue pelo menos uma vez.** Se a função for interrompida
  depois de o servidor SMTP aceitar o e-mail e antes de confirmar a mensagem na
  fila, a mensagem volta e o e-mail pode sair duas vezes. Essa repetição é
  aceita: evitá-la exigiria guardar o histórico de envios.

## 🧰 Stack

| Camada | Escolha | Por quê |
| --- | --- | --- |
| Runtime | Node.js 24 · TypeScript | Mesma stack dos serviços da solução |
| SMTP | `nodemailer` | Biblioteca de envio de e-mail que o Work Order já usa; envia sem TLS ao MailHog e tem limites de tempo de conexão |
| Validação | `zod` | Confere a mensagem contra o tipo de `notification.email.send` definido no catálogo de mensagens do Work Order |
| Log | `pino` | Uma linha JSON por registro na saída padrão (stdout), no mesmo formato dos serviços |
| Telemetria | OpenTelemetry | Cria o span de cada mensagem (o trecho do trace, o registro do caminho de um pedido entre os serviços, que cobre o processamento dela) e o envia por OTLP, o protocolo do OpenTelemetry, à Datadog Extension, a extensão do Datadog anexada à função; o mesmo padrão aberto dos serviços, sem código do Datadog |
| Build | `esbuild` | Gera um arquivo JavaScript único com todas as dependências; o `.zip` publicado é montado pelo Terraform — [ADR 0003](docs/adr/0003-camadas-enxutas-e-empacotamento.md) |
| Testes | Jest · Testcontainers | Testes unitários e de ponta a ponta; o Testcontainers sobe contêineres Docker durante o teste — [Testes](docs/testing.md) |

Nenhuma dependência usa código nativo compilado, então o mesmo pacote roda em
qualquer máquina e na AWS Lambda.

## ⚙️ Pré-requisitos

- **Node.js 24+**
- **Docker**, para subir o MailHog local e rodar os testes de ponta a ponta

Nenhuma credencial AWS é necessária para desenvolver.

## 🚀 Início rápido

```bash
# Instalar as dependências na pasta da aplicação
cd app
npm ci
# Criar a configuração local a partir do exemplo
cp .env.example .env
# Subir o MailHog local: recebe SMTP na porta 1025 e mostra os e-mails em http://localhost:8025
docker run -d --rm --name mailhog -p 1025:1025 -p 8025:8025 mailhog/mailhog:v1.0.1
# Executar a função uma vez com a mensagem de exemplo de events/notification.event.json
npm run invoke
```

A função responde `{ "batchItemFailures": [] }` — a lista de mensagens que
falharam, aqui vazia — e o e-mail aparece em `http://localhost:8025`. Passo a
passo completo em [Como executar localmente](docs/local-setup.md).

## 📜 Comandos

Todos rodam a partir de `app/`.

| Comando | O que faz |
| --- | --- |
| `npm run invoke` | Executa a função **uma** vez com a mensagem de `events/notification.event.json`, sem AWS |
| `npm run build` | Gera o pacote `dist/handler.js` (CommonJS) e o mapa de origem `dist/handler.js.map` |
| `npm test` | Testes unitários — sem contêiner e sem rede |
| `npm run test:cov` | Testes unitários com cobertura; falha abaixo de 100% em linhas, instruções, funções ou ramos |
| `npm run test:e2e` | Testes de ponta a ponta com LocalStack (emulador local da AWS) e MailHog |
| `npm run lint` | ESLint e Prettier, incluindo as regras que impedem uma camada interna de importar infraestrutura |
| `npm run typecheck` | Verificação de tipos do TypeScript (`tsc --noEmit`) |
| `npm run format` | Aplica a formatação do Prettier |

## 📁 Estrutura do Repositório

```text
.
├── .github/
│   ├── actions/setup-ci/       # Ação reutilizada pelos jobs: Node 24, cache npm e npm ci
│   └── workflows/              # CI, SAST e CD da função
├── app/
│   ├── src/
│   │   ├── domain/              # EmailMessage (regras do e-mail), catálogo de mensagens e exceções
│   │   ├── application/         # Caso de uso, interfaces (portas) e catálogo de eventos de log
│   │   ├── interface-adapters/  # Controller que traduz o resultado do envio
│   │   ├── infrastructure/     # Envio SMTP, logging, configuração e leitura da mensagem da fila
│   │   ├── bootstrap.ts        # Monta as dependências uma vez e as reaproveita
│   │   └── handler.ts          # Ponto de entrada chamado pela AWS Lambda
│   ├── test/                    # Testes unitários e E2E
│   ├── events/                  # Mensagem de exemplo para execução local
│   ├── localstack/              # Script que cria tópico e filas no LocalStack
│   ├── scripts/                 # Build e execução local
│   ├── .env.example            # Variáveis de ambiente de exemplo
│   └── package.json            # Dependências e comandos npm
├── docs/
│   ├── adr/                    # Registros de decisões de arquitetura (ADRs)
│   ├── diagrams/
│   │   ├── cd-workflow.png     # Jobs e steps do workflow de CD
│   │   ├── ci-workflow.png     # Jobs e steps do workflow de CI
│   │   └── infrastructure.png  # Tópico, fila, DLQ, função, NLB e MailHog
│   ├── architecture.md         # Camadas, montagem das dependências e fluxo de uma mensagem
│   ├── ci-cd.md                # Workflows, jobs, steps e configuração do GitHub
│   ├── contracts.md            # Formato da mensagem, validação e resposta
│   ├── local-setup.md          # Desenvolvimento local com MailHog
│   ├── logging.md              # Formato do log, campos e eventos
│   ├── observability.md        # Coleta pelo Datadog e correlação com o pedido
│   ├── security.md             # Dado sensível e riscos tratados
│   ├── terraform.md            # Recursos AWS, variáveis, outputs e execução local
│   └── testing.md              # Testes unitários, de ponta a ponta e cobertura
├── infra/                      # Terraform da função e da ligação com a fila
├── .gitignore
└── README.md
```

## 📚 Documentação

| Documento | Conteúdo |
| --- | --- |
| 📄 [Contrato](docs/contracts.md) | **Normativo**: formato de `notification.email.send`, regras de validação, o propósito do e-mail, motivos de falha e a resposta da função |
| 🏛️ [Arquitetura](docs/architecture.md) | Camadas, interfaces, montagem das dependências, fluxo de uma mensagem, pastas e como a função roda na AWS |
| 🔒 [Segurança](docs/security.md) | Dado sensível em trânsito, conteúdo fora do log, rede e credenciais |
| 📊 [Logging](docs/logging.md) | Formato de cada linha, todos os campos, os eventos e como rastrear um e-mail |
| 🔭 [Observabilidade](docs/observability.md) | O que a função registra, como o Datadog coleta e como ligar o e-mail ao pedido que o originou |
| 💻 [Como executar localmente](docs/local-setup.md) | Execução local, MailHog, build e variáveis de ambiente |
| 🧪 [Testes](docs/testing.md) | Testes unitários e de ponta a ponta, verificação depois do deploy, comportamentos travados por teste e cobertura |
| 🔁 [CI/CD](docs/ci-cd.md) | Os três workflows, as verificações depois do deploy, a configuração do GitHub e a solução de problemas |
| ☁️ [Infraestrutura](docs/terraform.md) | Recursos AWS criados, dados lidos de outros repositórios, variáveis, outputs e execução local |
| 📐 [ADR 0001](docs/adr/0001-envio-sem-templates.md) | Envio sem templates, do e-mail montado por quem pede |
| 📐 [ADR 0002](docs/adr/0002-uma-mensagem-por-invocacao.md) | Uma mensagem por execução, com a ordem por grupo garantida no código |
| 📐 [ADR 0003](docs/adr/0003-camadas-enxutas-e-empacotamento.md) | Camadas enxutas e empacotamento iguais aos da Lambda customer-auth |

## 🧩 Ecossistema

| Repositório | Papel | Relação com esta função |
| --- | --- | --- |
| [`oficina-mecanica-infra-messaging`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-messaging) | Mensageria (Terraform) | Cria o tópico `oficina-events.fifo`, a fila `notification.fifo` e a DLQ `notification-dlq.fifo` (mensagem vai para a DLQ após 5 recebimentos; retenção de 1 dia). Esta função lê o ARN da fila do Terraform desse repositório |
| [`oficina-mecanica-identity-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service) | Serviço de identidade | Pede e-mails de conta (senha inicial, redefinição de senha), sem ordem de serviço |
| [`oficina-mecanica-work-order-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-work-order-service) | Serviço de ordens de serviço | Pede e-mails ligados a uma OS. É dono do catálogo de mensagens, de onde esta função copia o tipo de `notification.email.send` |
| [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s) | Cluster Kubernetes (EKS) | Roda o MailHog no namespace `platform` e o expõe na porta 1025 de um balanceador de carga de rede (NLB) interno, que é o destino dos envios |
| [`oficina-mecanica-infra-base`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base) | Rede (Terraform) | Cria a VPC e as subnets privadas onde a função roda |
| [`oficina-mecanica-custom-monitoring`](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring) | Monitoramento | Dashboards e alertas no Datadog |
| [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth) | Outra função Lambda da solução | Autentica clientes por CPF e senha. Serviu de modelo para a estrutura deste repositório |
| **[`oficina-mecanica-lambda-notification`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification)** | **Esta função** | Entrega os e-mails e mantém a própria infraestrutura em `infra/` |

Caminho de um pedido de e-mail:

```text
Identity / Work Order ──publica──▶ tópico oficina-events.fifo ──▶ fila notification.fifo ──▶ esta função ──SMTP──▶ NLB interno :1025 ──▶ MailHog (namespace platform)
                                                                          │
                                                                          └── 5 recebimentos sem sucesso ──▶ DLQ notification-dlq.fifo
```

## 📦 Estado

[![Cobertura](https://sonarcloud.io/api/project_badges/measure?project=FIAP-15SOAT_oficina-mecanica-lambda-notification&metric=coverage)](https://sonarcloud.io/summary/new_code?id=FIAP-15SOAT_oficina-mecanica-lambda-notification)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=FIAP-15SOAT_oficina-mecanica-lambda-notification&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=FIAP-15SOAT_oficina-mecanica-lambda-notification)

- **Testes.** Os testes unitários cobrem 100% do código nas quatro métricas de
  cobertura do Jest: linhas, instruções (*statements*), funções e ramos
  (*branches*, cada caminho de um `if` ou operador condicional). Para conferir,
  rode `npm run test:cov` em `app/`. Os testes de ponta a ponta publicam um
  pedido no tópico, leem a fila e conferem o e-mail no MailHog.
- **Integração contínua.** Todo push numa branch `feature/**` ou `fix/**` roda
  seis verificações em paralelo — Lint, Type Check, Unit Tests, E2E Tests,
  Package e Terraform Validation — e, se todas passam, um bot abre o Pull
  Request. Os pull requests passam também pela análise estática de código no
  [SonarQube Cloud](https://sonarcloud.io/project/overview?id=FIAP-15SOAT_oficina-mecanica-lambda-notification),
  que bloqueia o merge quando o portão de qualidade (*quality gate*) reprova.
- **Entrega.** Depois do merge na `main`, o CD aplica o Terraform e faz duas
  verificações: executa a função publicada com um e-mail de teste e confere que
  esse e-mail chegou ao MailHog do cluster. Detalhes em [CI/CD](docs/ci-cd.md).
- **Infraestrutura.** O Terraform em [`infra/`](infra/) cria a função nas
  subnets privadas, o security group dela, o grupo de log no CloudWatch e a
  ligação que faz a AWS Lambda ler a fila `notification.fifo` (*event source
  mapping*).

## 👥 Autores

- [Guilherme da Rocha Salvador](https://github.com/guilhermesalvador404)
- [Lucas Almeida da Silva](https://github.com/lucas-almeida-silva)
- [Ramoon Lincoln Barros Camacho](https://github.com/ramooncamacho)
- [Renan Santana Camacho](https://github.com/renancamacho)

## 📄 Licença

Projeto acadêmico (FIAP — 15SOAT), para fins educacionais. Sem licença aberta
declarada (`UNLICENSED`).
