# Logging

A função escreve o log como JSON, uma linha por registro, na saída padrão do
processo (stdout). A AWS Lambda envia tudo o que sai no stdout para o CloudWatch
Logs, e o Datadog coleta de lá — ver [Observabilidade](observability.md).

O formato de cada linha e a regra de só aceitar campos declarados são os mesmos
dos serviços da solução (como o Work Order) e da customer-auth, a outra função
Lambda da solução. Assim, uma mesma consulta no Datadog funciona para todos. A
função registra **uma linha por mensagem tentada**, sem o conteúdo do e-mail.

## Formato da linha

Toda linha é um objeto JSON completo, terminado por quebra de linha. Três chaves
estão sempre presentes:

| Chave | Valor |
| --- | --- |
| `timestamp` | Data e hora ISO-8601 em **UTC** (`Z`) |
| `level` | Nível em texto (`info`, `error`), nunca o número interno do `pino` |
| `message` | Frase fixa do evento, **nunca** montada com dados do e-mail |

A escrita no stdout é **síncrona**: a linha sai antes de a função responder.
Depois da resposta, a AWS Lambda congela o processo, e uma escrita guardada em
buffer só sairia na execução seguinte — ou nunca. O código não depende de nenhuma
biblioteca do Datadog: quem coleta é a infraestrutura.

## Só campos declarados

O arquivo `app/src/infrastructure/logging/field-registry.ts` lista todos os
campos que podem sair no log. Um campo que não está na lista é **descartado**
antes de a linha ser escrita. Isso evita dois problemas: um campo novo chegar ao
Datadog sem tipo definido, e um dado passado por engano ao logger sair no log.

Um teste unitário (`handler.spec.ts`) confere que toda chave escrita durante os
testes está na lista.

Os nomes seguem as Semantic Conventions do OpenTelemetry — o padrão aberto de
nomes para telemetria (`service.name`, `faas.*`, `messaging.*`) — e usam o
prefixo `oficina.*` quando o padrão não tem nome para o conceito.

## Todos os campos

Nas tabelas, **cardinalidade** é quantos valores diferentes o campo costuma ter
(campos de alta cardinalidade custam mais para indexar no Datadog) e
**componente** é o arquivo que escreve o campo.

### Formato e serviço

| Campo | Tipo | Cardinalidade | Componente | O que é |
| --- | --- | --- | --- | --- |
| `timestamp` | string | alta | `logger.factory` | Data e hora |
| `level` | string | baixa | `logger.factory` | Nível |
| `message` | string | baixa | `logger.factory` | Frase do evento |
| `service.name` | string | baixa | `logger.config` | `oficina-mecanica-lambda-notification` |
| `service.namespace` | string | baixa | `logger.config` | `oficina-mecanica` |
| `service.version` | string | baixa | `logger.config` | Commit implantado |
| `deployment.environment.name` | string | baixa | `logger.config` | Valor de `NODE_ENV` |

### Execução da função na AWS

| Campo | Tipo | Cardinalidade | Componente | O que é |
| --- | --- | --- | --- | --- |
| `faas.invocation_id` | string | alta | `execution-attributes` | Id da execução, o mesmo do log da AWS Lambda |
| `faas.coldstart` | boolean | baixa | `execution-attributes` | `true` na primeira execução de um ambiente novo (partida a frio) |
| `faas.name` | string | baixa | `execution-attributes` | Nome da função |
| `faas.version` | string | baixa | `execution-attributes` | Versão da função executada |
| `faas.instance` | string | média | `execution-attributes` | Ambiente de execução (o stream de log) |
| `faas.max_memory` | number (bytes) | baixa | `execution-attributes` | Memória configurada |
| `cloud.provider` | string | baixa | `execution-attributes` | `aws` |
| `cloud.platform` | string | baixa | `execution-attributes` | `aws_lambda` |
| `cloud.region` | string | baixa | `execution-attributes` | Região |
| `cloud.resource_id` | string | baixa | `execution-attributes` | ARN da função |

### Correlação e mensagem

| Campo | Tipo | Cardinalidade | Componente | O que é |
| --- | --- | --- | --- | --- |
| `trace_id` | string | alta | `handler` (propagador W3C) | Id do trace do pedido que originou o e-mail; só quando a mensagem o traz |
| `messaging.message.id` | string | alta | `handler` | Id da mensagem (ver abaixo) |
| `messaging.destination.name` | string | baixa | `handler` | Fila de origem: `notification.fifo` |
| `oficina.work_order.id` | string | alta | `handler` | Id da ordem de serviço; só quando a mensagem tem OS |

### Erro

| Campo | Tipo | Cardinalidade | Componente | O que é |
| --- | --- | --- | --- | --- |
| `exception.type` | string | baixa | `error-serializer` | Classe da exceção, quando há uma |
| `exception.message` | string | média | `error-serializer` | Mensagem da exceção, depois da ocultação de dados |
| `exception.stacktrace` | string | alta | `error-serializer` | Pilha de chamadas, depois da ocultação de dados |

### Evento

| Campo | Tipo | Cardinalidade | Componente | O que é |
| --- | --- | --- | --- | --- |
| `oficina.event.name` | string | baixa | catálogos de evento | Nome do evento (`notification.sent`, ...) |
| `oficina.messaging.message.type` | string | baixa | `handler` | Tipo da mensagem: `notification.email.send` |
| `oficina.notification.purpose` | string | baixa | `handler` | Propósito do e-mail |
| `oficina.notification.recipient.count` | number | baixa | `handler` | Quantidade de destinatários; só quando o payload pôde ser lido |
| `oficina.notification.outcome` | string | baixa | `handler` | `sent`, `retry` ou `dead_lettered` |
| `oficina.notification.failure.reason` | string | baixa | `handler` | `invalid_message` ou `smtp_error`; só na falha |

Assunto, texto, HTML e endereços **não estão na lista de campos**. Não há como
registrá-los, nem parcialmente ocultos.

## Eventos

| Evento | Nível | `message` | Campos do evento |
| --- | --- | --- | --- |
| `notification.sent` | info | `email accepted by the smtp server` | tipo, propósito, quantidade de destinatários, `outcome` = `sent` |
| `notification.failed` | error | `email not delivered; the message returns to the queue` | tipo (se o envelope pôde ser lido), propósito, quantidade de destinatários (se o payload pôde ser lido), `outcome` = `retry` ou `dead_lettered` e o motivo `invalid_message` ou `smtp_error` |
| `app.configuration.invalid` | error | `execution environment could not be initialized` | dados da exceção (`exception.*`) |
| `app.initialization.failed` | error | `execution environment dependencies could not be initialized` | dados da exceção (`exception.*`) |

Os dois primeiros saem uma vez por mensagem tentada, com os campos de execução e
de mensagem. Uma mensagem devolvida sem ser tentada — porque uma anterior do
mesmo grupo FIFO falhou na mesma execução — não gera linha. Os dois últimos
saem quando a função não consegue montar as dependências, sem campos de
mensagem.

Na falha com `smtp_error`, `exception.type` é `EmailDeliveryException`, com uma
mensagem fixa. O adaptador SMTP descarta o erro original do `nodemailer` em vez
de anexá-lo, porque a resposta do servidor costuma repetir o destinatário
(`550 5.1.1 <maria@example.com>: Recipient address rejected`). Na falha com
`invalid_message` não há `exception.*`: o texto da validação descreveria o
conteúdo da mensagem, e o motivo basta para agir.

### `oficina.notification.outcome`

| Valor | Significa |
| --- | --- |
| `sent` | O servidor SMTP aceitou o e-mail |
| `retry` | Falhou; a mensagem volta à fila e será entregue de novo |
| `dead_lettered` | Falhou no quinto recebimento (`ApproximateReceiveCount` ≥ 5, o limite configurado na fila): a mensagem vai para a DLQ `notification-dlq.fifo` |

Separa a falha definitiva, que pede ação, da que ainda será tentada.

### `oficina.notification.purpose`

O propósito do e-mail, lido do campo `purpose` do pedido quando ele está no
formato aceito (letras minúsculas separadas por `_`, até 40 caracteres); em
qualquer outro caso, `unspecified` — ver
[Contrato › O propósito do e-mail](contracts.md#o-propósito-do-e-mail). Como o
formato não aceita dígito, `@`, espaço nem maiúscula, o valor vai ao log sem
ocultação. O campo sai **sempre**, mesmo como `unspecified`, para que contar as
falhas por propósito não deixe nenhuma de fora.

### `oficina.work_order.id`

O mesmo campo que o Work Order usa nos próprios logs, preenchido com o
`workOrderId` da mensagem quando ele existe. Liga o e-mail ao histórico da OS sem
dado pessoal. E-mails de conta, que não têm OS, saem sem o campo.

### `messaging.message.id`

O `messageId` do pedido — o mesmo que o serviço gravou ao publicar e o mesmo da
mensagem se ela for parar na DLQ. Quando a mensagem não é JSON válido e não dá
para ler o `messageId`, o campo traz o id que a SQS deu à mensagem.

## Como rastrear um e-mail

| Pergunta | Filtro no Datadog |
| --- | --- |
| Que tipo de e-mail falhou? | `oficina.notification.purpose` |
| Quais e-mails uma OS gerou? | `oficina.work_order.id` |
| Qual pedido, no serviço de origem, gerou o e-mail? | `trace_id` |
| O que aconteceu com a mensagem que está na DLQ? | `messaging.message.id` igual ao `messageId` do corpo dela |
| Quais falhas não serão mais tentadas? | `oficina.notification.outcome:dead_lettered` |

## O que nunca é registrado

Em nenhum nível e em nenhum resultado: o assunto, o texto, o HTML, os endereços
dos destinatários e o texto da resposta do servidor SMTP. Um e-mail pode conter
uma senha inicial ou um código de redefinição de senha, e o serviço que escreve
o assunto pode colocar ali o mesmo dado; a função não tem como reconhecê-lo.

Dois testes garantem isso. Um captura as linhas que o logger escreve durante o
envio de um e-mail com senha inicial no texto e confere que nenhuma contém o
assunto, o texto, o HTML ou o endereço. O outro simula uma recusa do servidor
SMTP que repete o destinatário e confere que o domínio dele não aparece.

## Sem `trace_id` inventado

O `trace_id` vem do atributo `traceparent` (padrão W3C Trace Context) que o
serviço anexa ao publicar o pedido. O ponto de entrada lê o atributo uma vez por
mensagem com o propagador W3C do OpenTelemetry — o componente que converte o
`traceparent` em contexto de trace e recusa o que foge do padrão — e usa o mesmo
resultado no log e como pai do span da mensagem, que assim nunca apontam para
traces diferentes.

Sem o atributo, ou com um valor inválido (versão `ff`, id do trace ou do span
pai só com zeros, letras maiúsculas, formato errado), a linha sai **sem** o
campo. Um id inventado faria o Datadog procurar um trace que não existe, o que é
pior que não ter o campo. Um `traceparent` válido mas **não amostrado** — o
serviço de origem decidiu não registrar aquele trace — mantém o `trace_id` no
log, mas não gera span.

Não há `span_id` no log: o span da mensagem e a linha de log se ligam pelo
`trace_id` e pelo `messaging.message.id` — ver
[Observabilidade › O span de cada mensagem](observability.md#o-span-de-cada-mensagem).

## Ocultação de dados

Campo fora da lista é descartado. Texto livre — a mensagem e a pilha de uma
exceção, e todo campo de evento do tipo texto — passa por uma limpeza
(`redaction/text-sanitizer.ts`): segredos (token JWT, cabeçalho de
autenticação, senha dentro de uma URL, `password=...`) são **removidos**, e
dados pessoais (CPF, CNPJ, e-mail, telefone) são **mascarados** mantendo o
formato (`maria@example.com` vira `m***@example.com`). É a segunda proteção; a primeira é o conteúdo
do e-mail nunca ser passado ao logger.

## Falhas do log e da telemetria no stderr

Duas falhas da própria observabilidade nunca mudam a execução nem a resposta da
função. Cada uma escreve uma linha JSON na saída de erro do processo (stderr),
separada do stdout, onde saem os eventos de log: o aviso não passa pelo caminho
que acabou de falhar. As duas linhas levam o mesmo `timestamp`, o mesmo `level`
e os mesmos campos de serviço das linhas de log.

| `message` | `level` | Quando | Campos próprios |
| --- | --- | --- | --- |
| `logging failure` | `error` | O próprio mecanismo de log falhou | `oficina.logging.failure.stage`: `serialization` (converter o valor de um campo), `emit` (montar a linha no `pino`, a biblioteca de log, ou campo não declarado) ou `destination` (escrever no stdout); `oficina.logging.failure.field`, o nome do campo, quando a falha é de um campo; `oficina.logging.failure.error_type`, o tipo do erro; `oficina.logging.failure.policy` = `continue-degraded` na falha do stdout, avisada uma vez só |
| `telemetry failure` | `warn` | O envio de spans falhou. O span é o registro do processamento de uma mensagem dentro do trace, o caminho de um pedido entre os serviços ([Observabilidade](observability.md#o-span-de-cada-mensagem)) | `oficina.telemetry.failure.stage`: `startup` (a montagem do envio de spans falhou, e a função segue sem spans) ou `export` (a extensão do Datadog recusou os spans, devolveu erro ou não respondeu em 500 ms, e os spans daquela execução se perdem); `oficina.telemetry.failure.error_type`, o tipo do erro (`Error`, `TypeError`, ou o tipo do valor lançado quando não é um erro) |

O que nunca entra nessas linhas: o valor do campo que causou a falha, a mensagem
do erro (que pode repetir o endereço do receptor ou dados da mensagem) e
qualquer conteúdo do e-mail. Elas não podem virar o caminho de vazamento que a
ocultação de dados existe para impedir.

## Origem do código copiado

O código de logging — lista de campos, ocultação de dados, conversão de exceções,
filtro de campos e aviso de falha — é **cópia adaptada** do da customer-auth
(`oficina-mecanica-lambda-customer-auth`, `app/src/infrastructure/logging/`), que
por sua vez o copiou do Work Order. O canal de diagnóstico no stderr segue o do
Work Order: a mesma função escreve as duas linhas de falha, com mensagem,
atributos e nível próprios. Ficou de fora o que só serve a uma função
chamada por HTTP: id de correlação lido de cabeçalho, linha por requisição e
medição de durações.

O tipo de `notification.email.send` (`app/src/domain/messaging/notification.messages.ts`)
é cópia do catálogo de mensagens do Work Order, com o commit de origem no
cabeçalho do arquivo, e não é editado aqui.

**Quando extrair para um pacote compartilhado:** quando manter as cópias iguais
passar a custar mais que publicar e versionar um pacote.
