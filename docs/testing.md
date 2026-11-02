# Testes

Há dois níveis de teste que rodam na máquina de quem desenvolve e no CI, e uma
verificação que só existe depois do deploy.

## Unitário — `npm test`

Sem contêiner e sem rede. Testa o domínio (`EmailMessage`), o caso de uso, o
controller, a leitura da mensagem da fila, o envio SMTP (com um transporte falso
no lugar do servidor), o ponto de entrada e o código de logging. As
implementações falsas das interfaces ficam em
`test/helpers/notification-mock.factory.ts`, e os eventos de fila de exemplo em
`test/helpers/sqs-event.factory.ts`. O log é capturado já formatado, do logger
real (`test/helpers/log-capture.ts`), e não de um logger falso.

É este nível que cobre 100% do código nas quatro métricas de cobertura do Jest:
linhas, instruções (*statements*), funções e ramos (*branches*, cada caminho de
um `if` ou operador condicional).

## Ponta a ponta — `npm run test:e2e`

O Testcontainers sobe dois contêineres Docker durante o teste:

- o **LocalStack 4.14.0**, um emulador local da AWS, com o tópico, a fila e a
  DLQ criados por `app/localstack/init-topology.sh` — a mesma configuração do
  repositório de mensageria;
- o **MailHog v1.0.1**, o servidor SMTP de teste, a mesma versão do cluster.

O teste então:

1. publica um pedido `notification.email.send` no tópico `oficina-events.fifo`,
   com o atributo `traceparent`;
2. lê a mensagem da fila `notification.fifo`, como a AWS Lambda faria;
3. chama o ponto de entrada real da função, com as dependências reais, apontando
   para o MailHog;
4. confere o e-mail pela API do MailHog.

| Cenário | O que confere |
| --- | --- |
| E-mail válido | `batchItemFailures` vazio; o MailHog tem um e-mail com o mesmo destinatário, assunto, texto e HTML |
| Sem destinatário | A mensagem volta em `batchItemFailures`; o MailHog não recebe nada |

Prova o que o teste unitário não alcança: a mensagem chega à fila exatamente
como foi publicada, no formato real da SQS, e a conversa SMTP funciona com o
mesmo servidor do cluster. Só precisa do Docker; nenhum outro repositório é
clonado.

## Verificação depois do deploy

Os dois níveis acima testam o código. Nenhum deles prova que o **pacote
publicado na AWS** carrega e alcança o MailHog do cluster. Para isso o CD faz
duas verificações depois de aplicar o Terraform:

| Verificação | O que prova |
| --- | --- |
| Executar a função publicada com uma mensagem `notification.email.send` de teste | O pacote carrega, a configuração é válida e a função alcança a porta SMTP do NLB: a resposta tem `batchItemFailures` vazio |
| Procurar o e-mail no MailHog do namespace `platform` | O e-mail chegou ao MailHog, não só saiu da função |

Detalhes em [CI/CD › As duas verificações depois do deploy](ci-cd.md#as-duas-verificações-depois-do-deploy).

## Comportamentos travados por teste

Estes testes não existem para aumentar a cobertura: existem para que uma mudança
bem-intencionada não desfaça uma decisão sem que algum teste falhe.

| Comportamento | Onde |
| --- | --- |
| Destinatário com vírgula, `;`, nome de exibição, espaço ou sem domínio é recusado | `email-message.vo.spec.ts` |
| `html` ou `text` como objeto (referência a arquivo ou URL) é recusado | `notification-message.parser.spec.ts` |
| Uma recusa do servidor SMTP que repete o destinatário não deixa o endereço nem o domínio no log | `smtp-email-sender.spec.ts` e `handler.spec.ts` |
| Assunto, texto, HTML e destinatário de um e-mail enviado não aparecem em nenhuma linha de log | `handler.spec.ts` |
| Toda chave escrita no log está na lista de campos permitidos | `handler.spec.ts` |
| E-mail sem OS (`workOrderId` nulo ou ausente) e payload com campo a mais são aceitos | `notification-message.parser.spec.ts` |
| `traceparent` ausente, malformado ou com id só de zeros: o e-mail sai e o log fica sem `trace_id` | `trace-context.spec.ts` e `handler.spec.ts` |
| Propósito com conteúdo ou fora do formato (`Senha inicial: ...`, endereço, dígitos, maiúsculas, 41 caracteres, número) vira `unspecified` e não impede o envio | `notification-message.parser.spec.ts` e `handler.spec.ts` |
| O propósito é lido mesmo quando o resto do payload é inválido | `notification-message.parser.spec.ts` e `handler.spec.ts` |
| Quando uma mensagem falha, ela e as seguintes do mesmo grupo voltam sem serem tentadas; as de outro grupo são enviadas | `handler.spec.ts` |
| A falha no quinto recebimento sai como `dead_lettered` | `handler.spec.ts` |
| O cliente SMTP conecta sem TLS e com limites de 2 s para conexão, saudação e resposta | `smtp-email-sender.spec.ts` |
| Uma montagem de dependências que falhou é tentada de novo na execução seguinte | `bootstrap.spec.ts` |
| O pacote gerado carrega **sem nenhuma dependência instalada**, fora da pasta do repositório | job `Package` do CI |

## Cobertura

100% em linhas, instruções, funções e ramos, exigido pelo `coverageThreshold` de
`app/jest.config.ts`: `npm run test:cov` falha abaixo disso.

Ficam fora da conta só arquivos sem lógica para testar:

| Arquivos | Por quê |
| --- | --- |
| `src/bootstrap.ts` | Só monta as dependências. Tem teste próprio, que não entra na métrica |
| `src/**/*.interface.ts` | Interfaces: só tipos, que somem na compilação |
| `src/**/*.catalog.ts` | Catálogos de eventos de log: só dados |

A mesma lista está em `app/sonar-project.properties`, para que a cobertura local
e a do SonarQube Cloud meçam os mesmos arquivos. Arquivos que só declaram tipos
(`notification.messages.ts`, `log-field.ts`, DTOs) não geram código e não entram
na conta.
