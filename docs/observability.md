# Observabilidade

A solução usa o **Datadog** como plataforma de observabilidade: é onde ficam os
logs, as métricas e os traces de todos os serviços. Esta função não tem nenhum
código do Datadog. Ela escreve o log no stdout e registra um span por mensagem —
o registro do processamento da mensagem dentro do trace, o caminho de um pedido
entre os serviços — com o OpenTelemetry, o padrão aberto de telemetria que os
serviços também usam; uma extensão anexada à função na AWS envia os dois ao
Datadog.

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

### Um span por mensagem com contexto de trace

O registro do processamento da mensagem dentro do trace de quem pediu o e-mail,
com o resultado de cada tentativa — ver
[O span de cada mensagem](#o-span-de-cada-mensagem).

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
roda ao lado da função, lê o que ela escreve no stdout, recebe os spans que ela
envia por OTLP (o protocolo de envio do OpenTelemetry) e manda os dois ao
Datadog. O código da função não tem biblioteca nem invólucro do Datadog no ponto
de entrada: usa só o OpenTelemetry, e trocar o destino muda apenas variáveis de
ambiente e a layer. A customer-auth, a outra função Lambda da solução, usa a
mesma extensão, só para os logs.

| | |
| --- | --- |
| Liga e desliga | Variable `ENABLE_TELEMETRY_COLLECTION` do repositório no GitHub; o CD a passa ao Terraform como `TF_VAR_enable_telemetry_collection` |
| Chave do Datadog | Segredo `DD_API_KEY` da organização no GitHub |
| Layer | `Datadog-Extension`, versão 102, publicada pela conta `464622532012`; valores padrão de variáveis do Terraform |
| `DD_SITE` | `us5.datadoghq.com`, a região da conta Datadog da solução |
| `DD_SERVICE` | `oficina-mecanica-lambda-notification`, o nome do serviço no Datadog |
| `DD_ENV` | `production`, o mesmo ambiente dos serviços, para as consultas por ambiente incluírem esta função; a extensão também tira dela o `env` dos spans |
| `DD_VERSION` | O commit implantado; a extensão também tira dela o `version` dos spans |
| `DD_SERVERLESS_LOGS_ENABLED` | `true`: a extensão envia os logs da função |
| `DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT` | `localhost:4318`: liga o receptor OTLP/HTTP da extensão, que recebe os spans da função |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318`: o endereço para onde a função envia os spans; sem ela, a função não envia span |
| `DD_TRACE_ENABLED` | `false`: a extensão não lê esta variável; só a biblioteca do Datadog que cria spans no código (`dd-trace`) a leria, e o `false` evita trace duplicado se alguém acrescentar essa biblioteca à função |

Com a coleta desligada, a função é criada **sem** a extensão e funciona
normalmente; os logs continuam no CloudWatch. Com a coleta ligada e sem a chave,
o CD falha antes de chamar a AWS.

## Ligando o e-mail ao pedido que o originou

Um **trace** é o registro de uma requisição através dos serviços: cada etapa é
um *span*, e todos compartilham o mesmo id de trace. Quando um serviço publica um
pedido de e-mail, ele anexa à mensagem o atributo `traceparent` (padrão W3C
Trace Context), que leva o id do trace em andamento e o id do span em que o
serviço publicou o pedido. A fila preserva o atributo.

A função lê o `traceparent` uma vez por mensagem e usa o resultado de duas
formas: copia o id do trace para o campo `trace_id` de toda linha de log daquela
mensagem e registra o span da mensagem como filho do span do serviço. No
Datadog, o envio do e-mail aparece dentro do trace do pedido (o cadastro do
funcionário, o envio do orçamento), e o log aparece junto. Nenhum id é
inventado quando o contexto falta.

| Campo | Liga o e-mail a |
| --- | --- |
| `trace_id` | O pedido, no serviço que o publicou |
| `oficina.work_order.id` | O histórico da ordem de serviço |
| `messaging.message.id` | A mensagem gravada pelo serviço ao publicar e, se for o caso, a mensagem na DLQ |
| `faas.invocation_id` | O registro da execução na AWS Lambda |

`trace_id`, `oficina.work_order.id` e `messaging.message.id` saem com os mesmos
valores no log e no span da mesma mensagem.

## O span de cada mensagem

### O que o span mostra

| | |
| --- | --- |
| Nome | `process notification.fifo`: a operação e a fila, como no padrão de nomes do OpenTelemetry para mensageria |
| Tipo | `CONSUMER`, o de quem processa uma mensagem recebida |
| Pai | O span em que o serviço publicou o pedido, lido do `traceparent` (e do `tracestate`, um atributo opcional do mesmo padrão com dados de cada fornecedor) |
| Cobre | A leitura da mensagem, a validação e o envio SMTP daquela mensagem |
| Atributos | `messaging.system` = `aws_sqs`, `messaging.operation.name` e `messaging.operation.type` = `process`, `messaging.destination.name` = `notification.fifo`, `messaging.message.id`, `oficina.notification.purpose`, `oficina.notification.outcome` e, só quando o pedido tem OS, `oficina.work_order.id`; os valores são os mesmos do evento de log da mensagem |
| Na falha | Status de erro, sem descrição, e `error.type` com o motivo: `invalid_message` ou `smtp_error` |
| Serviço | `service.name`, `service.namespace`, `service.version` e `deployment.environment.name`, os mesmos do log. No Datadog, o `service` sai do `service.name`, e o `env` e o `version`, das variáveis `DD_ENV` e `DD_VERSION` da função, que têm os mesmos valores |

**Um span por entrega.** Uma mensagem que falha volta à fila e é entregue de
novo; cada entrega gera outro span, no mesmo trace e com o mesmo pai, com o
resultado daquela tentativa. Uma mensagem que vai para a DLQ deixa cinco spans:
quatro com `retry` e o último com `dead_lettered`.

### Mensagem sem contexto de trace não tem span

A função só registra o span quando o `traceparent` traz um contexto válido e
**amostrado**. A amostragem é a decisão, tomada pelo serviço que abriu o trace,
de registrar ou não aquele trace; ela viaja no último campo do `traceparent`
(`-01` registra, `-00` não). A leitura é feita pelo propagador W3C do
OpenTelemetry, o componente que converte o `traceparent` em contexto de trace e
recusa o que foge do padrão.

| `traceparent` | E-mail | Span | `trace_id` no log |
| --- | --- | --- | --- |
| Válido e amostrado | enviado | sim | sim |
| Válido e não amostrado | enviado | não | sim |
| Ausente | enviado | não | não |
| Inválido: versão `ff`, id do trace ou do span só com zeros, letras maiúsculas ou formato errado | enviado | não | não |

Sem contexto, a função não começa um trace novo: seria um trace solto a cada
publicação manual, sem nada que o ligasse ao pedido.

### O que nunca entra no span

O assunto, o texto, o HTML, os endereços dos destinatários (nem mascarados) e o
texto de erro do servidor SMTP, que costuma repetir o destinatário. O span não
registra a exceção nem descreve o erro no status: o motivo da falha vai só em
`error.type`, e o detalhe fica no log, que passa pela ocultação de dados e se
liga ao span pelo `trace_id` e pelo `messaging.message.id`. Os atributos saem de
uma lista fechada no código: nada do conteúdo do e-mail é copiado, e os ids e o
propósito só entram depois da validação da mensagem.

### Como o span chega ao Datadog

A função envia cada span por OTLP/HTTP ao endereço de
`OTEL_EXPORTER_OTLP_ENDPOINT`, que na AWS é `http://localhost:4318`: o receptor
da Datadog Extension, no mesmo ambiente de execução. A extensão o repassa ao
APM, a área do Datadog que mostra traces e spans. A função espera o envio antes
de responder, por no máximo 500 ms, uma vez por execução.

Sem `OTEL_EXPORTER_OTLP_ENDPOINT`, com a coleta desligada ou na máquina de quem
desenvolve, a função não tenta enviar spans, e o log continua com o
`trace_id`.

**Falha no envio.** Se a extensão recusa os spans, devolve erro ou não responde
em 500 ms, a função responde do mesmo jeito, com a mesma lista de mensagens que
falharam, e escreve na saída de erro do processo (stderr) a linha
`telemetry failure` com o estágio `export`. O span daquela execução se perde; o
log não. A mesma linha, com o estágio `startup`, sai quando a montagem do envio
de spans falha, e a função segue sem spans — ver
[Logging](logging.md#falhas-do-log-e-da-telemetria-no-stderr).

### Como conferir o span

Com uma mensagem que traga `traceparent` válido e amostrado:

1. pegar o `trace_id` da linha `notification.sent` ou `notification.failed` da
   mensagem;
2. no APM do Datadog, buscar o trace por esse id;
3. conferir no trace o span `process notification.fifo` do serviço
   `oficina-mecanica-lambda-notification`, filho do span de publicação do
   serviço que pediu o e-mail, com o `env` e o `version` da linha de log e o
   resultado em `oficina.notification.outcome`.

Sem o span e sem linha `telemetry failure` no CloudWatch, conferir se a função
tem `OTEL_EXPORTER_OTLP_ENDPOINT` e a extensão anexada.

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

A mensagem da verificação não tem `traceparent` e, por isso, não gera span; o
span se confere com uma mensagem que traga o contexto — ver
[Como conferir o span](#como-conferir-o-span).

Dashboards e alertas ficam em
[`oficina-mecanica-custom-monitoring`](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring).
