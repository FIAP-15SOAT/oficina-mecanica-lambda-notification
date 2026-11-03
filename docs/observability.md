# Observabilidade

A solução usa o **Datadog** como plataforma de observabilidade: é onde ficam os
logs, as métricas e os traces de todos os serviços. Esta função não tem nenhum
código do Datadog. Ela só escreve o log no stdout, e uma extensão anexada à
função na AWS envia essas linhas ao Datadog.

## O que a função produz

### Um evento de log por mensagem tentada

`notification.sent` ou `notification.failed`, com:

| Campo | Responde |
| --- | --- |
| `oficina.notification.outcome` | O e-mail saiu (`sent`), vai ser tentado de novo (`retry`) ou a mensagem vai para a DLQ (`dead_lettered`)? |
| `oficina.notification.failure.reason` | A falha foi do serviço que mandou a mensagem (`invalid_message`) ou do servidor de e-mail (`smtp_error`)? |
| `oficina.notification.purpose` | Que tipo de e-mail era? |
| `oficina.notification.recipient.count` | Para quantos destinatários? |
| `trace_id`, `oficina.work_order.id`, `messaging.message.id` | De qual pedido, OS e mensagem veio? |
| `faas.*`, `cloud.*` | Qual execução, se foi partida a frio (primeira execução de um ambiente novo), versão da função e região |
| `service.*` | Nome, grupo, **versão** (o commit implantado) e ambiente do serviço |

Detalhes em [Logging](logging.md).

### O que a AWS mede sozinha

A AWS Lambda mede, sem código na função, execuções, erros, duração, execuções
recusadas por limite e partidas a frio. A SQS mede, para a fila e para a DLQ, a
idade da mensagem mais antiga e quantas mensagens estão esperando. Essas métricas
ficam no CloudWatch; a função não as recalcula.

Um e-mail que falha **não** conta como erro da função: a mensagem volta em
`batchItemFailures` e a execução termina normalmente. A métrica de erros da
função (`Errors`) só sobe quando a função não consegue montar as dependências
ou o pacote está quebrado. O sinal de e-mail não entregue é o evento
`notification.failed`; o de e-mail que desistiu de ser enviado é a DLQ com
mensagens.

## A extensão que coleta

A coleta é feita pela **Datadog Extension**, anexada à função como *layer* — um
pacote extra que a AWS Lambda carrega junto com o código da função. A extensão
roda ao lado da função, lê o que ela escreve no stdout e envia ao Datadog. O
código da função não muda: nenhuma dependência, nenhum invólucro no ponto de
entrada. É a mesma configuração da customer-auth, a outra função Lambda da
solução.

| | |
| --- | --- |
| Liga e desliga | Variable `ENABLE_TELEMETRY_COLLECTION` do repositório no GitHub; o CD a passa ao Terraform como `TF_VAR_enable_telemetry_collection` |
| Chave do Datadog | Segredo `DD_API_KEY` da organização no GitHub |
| Layer | `Datadog-Extension`, versão 99, publicada pela conta `464622532012`; valores padrão de variáveis do Terraform |
| `DD_SITE` | `us5.datadoghq.com`, a região da conta Datadog da solução |
| `DD_SERVICE` | `oficina-mecanica-lambda-notification`, o nome do serviço no Datadog |
| `DD_ENV` | `production`, o mesmo ambiente dos serviços, para as consultas por ambiente incluírem esta função |
| `DD_VERSION` | O commit implantado |
| `DD_SERVERLESS_LOGS_ENABLED` | `true`: a extensão envia os logs da função |
| `DD_TRACE_ENABLED` | `false`: a função não produz trace |

Com a coleta desligada, a função é criada **sem** a extensão e funciona
normalmente; os logs continuam no CloudWatch. Com a coleta ligada e sem a chave,
o CD falha antes de chamar a AWS.

## Ligando o e-mail ao pedido que o originou

Um **trace** é o registro de uma requisição através dos serviços: cada etapa é
um *span*, e todos compartilham o mesmo id de trace. Quando um serviço publica um
pedido de e-mail, ele anexa à mensagem o atributo `traceparent` (padrão W3C
Trace Context), que leva o id do trace em andamento. A fila preserva o atributo,
e a função copia o id para o campo `trace_id` de toda linha de log daquela
mensagem. No Datadog, o log do e-mail aparece junto do trace do pedido — o
cadastro do funcionário, o envio do orçamento.

A função **não continua o trace**: não cria span próprio nem repassa o contexto
adiante. A ligação é só pelo `trace_id` no log, e nenhum id é inventado quando
ele falta.

| Campo | Liga o e-mail a |
| --- | --- |
| `trace_id` | O pedido, no serviço que o publicou |
| `oficina.work_order.id` | O histórico da ordem de serviço |
| `messaging.message.id` | A mensagem gravada pelo serviço ao publicar e, se for o caso, a mensagem na DLQ |
| `faas.invocation_id` | O registro da execução na AWS Lambda |

## Pendente: spans pela extensão

Para continuar o trace, a função precisaria enviar spans. A Datadog Extension
pode aceitar spans no protocolo do OpenTelemetry (OTLP), mas isso ainda não foi
testado nesta conta. Por isso `DD_TRACE_ENABLED` é `false` e a função não tem
biblioteca de tracing.

**Quando reabrir:** se a extensão aceitar spans OTLP, a função passa a criar um
span ligado ao trace recebido no `traceparent`, e a ligação deixa de depender só
do log.

## Como conferir a coleta

Uma entrega verde com a coleta ligada não prova que os logs chegam ao Datadog.
Depois de uma execução — a verificação do CD faz uma —, conferir no Datadog:

1. a linha `notification.sent` da verificação, com
   `oficina.notification.purpose` igual a `post_deploy_gate` e `service.version`
   igual ao commit implantado;
2. nenhuma linha com o assunto do e-mail de teste
   (`post-deploy-gate-<id da execução do workflow>-<número da tentativa>`).

Se a linha está no grupo de log `/aws/lambda/lbd-oficina-mecanica-notification`
do CloudWatch mas não no Datadog, a falha é **da coleta**, não da função.
Dashboards e alertas ficam em
[`oficina-mecanica-custom-monitoring`](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring).
