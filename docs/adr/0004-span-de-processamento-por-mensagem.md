# ADR 0004: Span de processamento por mensagem, enviado à extensão por OTLP

## Status

Aceito — 2026-11-04

## Contexto

Um **trace** é o registro de um pedido através dos serviços da solução, e cada
etapa dele é um **span**. Os serviços da solução, como o Work Order, registram
spans com o OpenTelemetry, o padrão aberto de telemetria, e os enviam ao APM do
Datadog, a área que mostra traces e spans. Quando um serviço pede um e-mail, a
mensagem `notification.email.send` leva no atributo `traceparent` (padrão W3C
Trace Context) o id do trace e o do span em que o serviço publicou o pedido.

Até aqui a função só copiava o id do trace para o campo `trace_id` do log. O
trace do pedido terminava na publicação: o envio do e-mail, as novas tentativas
e o resultado de cada uma ficavam fora dele, visíveis só nos logs.

A função já tinha a **Datadog Extension**, uma extensão anexada como *layer* (um
pacote extra que a AWS Lambda carrega com o código), que lê o log da função e o
envia ao Datadog. A extensão também aceita spans por **OTLP** (o protocolo de
envio do OpenTelemetry) num receptor local, em `localhost:4318`, ligado por
variável de ambiente. Esse caminho foi provado na solução com spans OTLP/HTTP em
JSON, na versão 99 da layer.

Três restrições pesam na escolha:

- a resposta da função (`batchItemFailures`, a lista de mensagens que falharam)
  decide o que volta à fila; uma falha de telemetria que mudasse a resposta
  reenviaria o e-mail;
- o e-mail pode conter uma senha inicial, e o erro do servidor SMTP costuma
  repetir o destinatário: nada disso pode chegar ao span;
- a AWS Lambda pode congelar o ambiente de execução logo depois da resposta, e
  um span não enviado até ali fica parado.

## Decisão

**Um span por mensagem, criado com o SDK do OpenTelemetry e enviado à Datadog
Extension por OTLP/HTTP antes da resposta.**

- **SDK do OpenTelemetry, span manual.** `@opentelemetry/api`,
  `@opentelemetry/core` (o propagador W3C, que converte o `traceparent` em
  contexto de trace), `@opentelemetry/resources`, `@opentelemetry/sdk-trace` e
  `@opentelemetry/exporter-trace-otlp-http`, na linha 2.x que os serviços usam:
  API 1.9, SDK 2.12 e exportador 0.223. Nada do Datadog no código:
  trocar o destino muda só variáveis de ambiente e a layer.
- **Filho do `traceparent`, um por entrega.** O ponto de entrada lê
  `traceparent` e `tracestate` uma vez por mensagem e usa o resultado como pai
  do span `process notification.fifo`, do tipo `CONSUMER` (o de quem processa
  uma mensagem recebida), e como origem do
  `trace_id` do log. Cada nova entrega de uma mensagem que falhou gera outro
  span no mesmo trace, com o resultado daquela tentativa.
- **Sem contexto, sem span.** A amostragem — a decisão, tomada por quem abriu o
  trace, de registrá-lo ou não — segue o pai: um span com pai amostrado é
  registrado; sem pai, com pai inválido ou não amostrado, o span não é gravado
  nem enviado. O ponto de entrada abre o span do mesmo jeito em todos os casos.
- **Atributos de uma lista fechada.** Os de mensageria do OpenTelemetry, o id da
  mensagem, o propósito, o resultado e, quando há, o id da OS; na falha, status
  de erro sem descrição e `error.type` (`invalid_message` ou `smtp_error`).
  Nunca exceção registrada, texto de erro, assunto, texto, HTML ou endereço.
- **Envio antes da resposta, com limite.** O processador simples do SDK envia
  cada span ao terminar, e a função espera o envio uma vez por execução, depois
  das mensagens e antes de responder, por no máximo 500 ms.
- **Falha da telemetria nunca muda a resposta.** Uma falha ao montar o envio ou
  ao enviar é capturada: a função responde com a mesma `batchItemFailures` e
  escreve na saída de erro do processo (stderr) a linha `telemetry failure`,
  com o estágio (`startup` ou `export`) e só o tipo do erro.
- **Ligado pela coleta de telemetria.** O código só envia spans quando
  `OTEL_EXPORTER_OTLP_ENDPOINT` existe. O Terraform define essa variável
  (`http://localhost:4318`) e a que liga o receptor da extensão
  (`DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT = localhost:4318`) só com a
  coleta ligada, mantém `DD_TRACE_ENABLED = false` e sobe a layer para a versão
  102.

## Alternativas consideradas

**Biblioteca de tracing do Datadog (`dd-trace`, pelo invólucro
`datadog-lambda-js`).**

- A favor: instrumentação pronta para a AWS Lambda, com o span da invocação.
- Contra: troca o padrão aberto dos serviços por um de fornecedor; o leitor de
  contexto das mensagens SQS dele procura o formato do Datadog e o da AWS, não o
  `traceparent` dos serviços, que se perderia sem um leitor próprio; exige trocar
  o ponto de entrada pelo invólucro do Datadog; e o Datadog orienta não usá-lo
  junto com o OTLP da extensão.

Rejeitada.

**Instrumentação automática do OpenTelemetry para a AWS Lambda
(`@opentelemetry/instrumentation-aws-lambda`).**

- A favor: menos código de span na função.
- Contra: precisa ser carregada antes do código da função, com um segundo
  arquivo no pacote; cria um span por execução, do tipo `SERVER`, com um único
  pai para todas as mensagens recebidas; os atributos de mensageria e o
  resultado precisariam de código próprio do mesmo jeito.

Rejeitada.

**Layer do OpenTelemetry para Lambda, com coletor próprio.**

- Contra: uma segunda extensão ao lado da do Datadog, para o mesmo caminho até o
  mesmo destino.

Rejeitada.

**Versão 3.0 do SDK do OpenTelemetry.** A 3.0 saiu em 2026-10-20.

- Só nesta função: duas linhas de versões na solução até os serviços migrarem.
- Em todos os repositórios agora: subir juntos os pacotes de cada serviço e
  repetir a conferência de telemetria em cada um, para uma linha 2.x que ainda
  recebe correções até 2027-10-20. O `@opentelemetry/sdk-trace` 2.12 tem a mesma
  API da 3.0, então a migração desta função será só de versões.
- Os pacotes `sdk-trace-base` e `sdk-trace-node` (este, usado nos testes dos
  serviços) estão marcados como obsoletos em favor do `@opentelemetry/sdk-trace`.

Rejeitada; a função usa a 2.12 com o pacote novo.

**Span raiz com link para o span do produtor**, o que a convenção de mensageria
do OpenTelemetry recomenda para lotes.

- Contra: o e-mail sairia do trace de quem o pediu, e cada tentativa viraria um
  trace próprio. Aqui o span cobre uma única mensagem, caso em que a convenção
  aceita o contexto da mensagem como pai.

Rejeitada. **Pai e link ao mesmo tempo** também: o link repetiria a relação que o
pai já dá, e o consumidor dos serviços não o usa.

**Span raiz de trace novo quando a mensagem não traz contexto.**

- Contra: um trace solto a cada publicação manual, sem `trace_id` no log para
  ligá-lo a nada.

Rejeitada. **Um `if` no ponto de entrada antes de abrir o span** daria o mesmo
resultado com código próprio, sem cobrir o pai não amostrado: a amostragem do
SDK já decide.

**Deixar a falha do envio subir.**

- Contra: a execução falharia, a mensagem voltaria à fila e o e-mail sairia de
  novo, até a mensagem ir para a DLQ (a fila que guarda as mensagens que
  falharam cinco vezes), por causa da telemetria.

Rejeitada. **Engolir a falha sem registro** também (os spans sumiriam sem sinal),
assim como **um evento de log próprio no stdout** (um segundo nome para a mesma
falha que os serviços registram no stderr) e **a janela que suprime repetições
do Work Order** (lá os exportadores podem falhar muitas vezes por minuto; aqui a
falha sai no máximo uma vez por execução).

**O código ler uma variável do Datadog como interruptor.**

- Contra: acopla o código ao fornecedor. `OTEL_EXPORTER_OTLP_ENDPOINT` é a
  variável padrão do OpenTelemetry, a mesma dos serviços.

Rejeitada. **Remover `DD_TRACE_ENABLED` ou passá-la a `true`** também: as
versões 99 e 102 da extensão não a leem, ela só vale para a biblioteca do
Datadog, e o `false` evita trace duplicado se alguém acrescentar essa
biblioteca. **gRPC na porta 4317**: outro transporte, sem ganho sobre o HTTP já
provado. **Ficar na layer 99**: adiaria a atualização de segurança da 102, de
2026-11-02, que não muda o receptor OTLP, e a conferência do span teria de ser
repetida depois.

## Consequências

**Positivas.** O envio do e-mail aparece no trace de quem o pediu, com um span
por tentativa e o resultado de cada uma. O log e o span leem o `traceparent` uma
única vez, e não apontam para traces diferentes. Sem a coleta, a função funciona
como antes, sem tentar enviar spans.

**Negativas.**

- Pacote e partida a frio maiores, pela medida local na mesma máquina: o
  `dist/handler.js` passou de 1.361.793 B para 2.074.565 B, o `.zip` de 392.171 B
  para 564.676 B, e a carga do módulo de 99,7 ms para 130,4 ms (melhor de cinco).
- Até 500 ms a mais por execução quando a extensão trava. Um servidor SMTP lento
  que termina perto dos 5 s da função, seguido da extensão travada, pode estourar
  o tempo limite: a mensagem volta à fila e o e-mail sai de novo, como já
  acontecia com um SMTP lento.
- Uma falha no envio perde o span daquela execução; o log continua com o
  `trace_id`.
- O span não traz o texto do erro; o detalhe fica no log, ligado ao span pelo
  `trace_id` e pelo `messaging.message.id`.

## Revisar se

- a solução trocar o OpenTelemetry pelo `dd-trace`, a biblioteca do Datadog;
- os serviços migrarem para o SDK 3.0, ou uma correção necessária só sair na 3.x;
- a função passar a consumir mensagens em lote ou ganhar um span de execução em
  volta do processamento;
- surgir um produtor sem contexto W3C, ou a latência de todo processamento virar
  requisito no APM;
- a linha `telemetry failure` com o estágio `export` mostrar a extensão
  respondendo devagar, ou a partida a frio pesar no consumo da fila;
- uma versão nova da layer passar a ler `DD_TRACE_ENABLED` ou mudar o receptor
  OTLP; toda troca de versão repete a conferência do span.

## Referências

- [Observabilidade › O span de cada mensagem](../observability.md#o-span-de-cada-mensagem)
- [Arquitetura › Fluxo de uma execução](../architecture.md#fluxo-de-uma-execução)
- [Logging › Falhas do log e da telemetria no stderr](../logging.md#falhas-do-log-e-da-telemetria-no-stderr)
- [Work Order › ADR 0021: span de consumo de mensagens](https://github.com/FIAP-15SOAT/oficina-mecanica-work-order-service/blob/main/docs/adr/0021-span-de-consumo-de-mensagens.md)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry › Semantic Conventions para spans de mensageria](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)
