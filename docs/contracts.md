# Contrato do envio de e-mail

> **Documento normativo.** Ele define o que um serviço publica para pedir um
> e-mail e o que a função faz com cada pedido. Os serviços que pedem e-mails
> (hoje o Identity e o Work Order) seguem **este** documento.

## Como o pedido chega

O serviço que precisa mandar um e-mail publica uma mensagem no tópico de eventos
da solução. O tópico copia a mensagem para a fila desta função, e a AWS Lambda
lê a fila e entrega a mensagem à função.

| | |
| --- | --- |
| Tópico (Amazon SNS) | `oficina-events.fifo`, compartilhado por todos os eventos da solução |
| Fila (Amazon SQS) | `notification.fifo`, assinada no tópico só para o tipo `notification.email.send` |
| Entrega bruta | A assinatura usa *raw message delivery*: o corpo da mensagem na fila é exatamente o JSON que o serviço publicou, sem o invólucro que o SNS acrescentaria |
| Atributos da mensagem | `type`, usado pela assinatura para filtrar o tipo; e `traceparent`, quando o serviço tem um trace aberto (ver abaixo) |
| Grupo da fila FIFO | Numa fila FIFO, mensagens com o mesmo `MessageGroupId` são entregues em ordem, uma por vez. O Work Order usa o id da ordem de serviço (OS) como grupo; o Identity, que não tem OS, usa um grupo por e-mail |

O `traceparent` segue o padrão W3C Trace Context: identifica o trace — o
registro de uma requisição através dos serviços — em que o serviço estava quando
pediu o e-mail. A função o usa só para ligar o log do e-mail a esse pedido.

## Formato da mensagem

Toda mensagem da solução tem um **envelope** comum (identificação, tipo, data e
OS) e um **payload** com os dados próprios do tipo. Exemplo de
`notification.email.send`:

```json
{
  "messageId": "6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c",
  "type": "notification.email.send",
  "occurredAt": "2026-11-01T12:00:00.000Z",
  "workOrderId": "3f0b6a6e-2a8b-4c7e-9b7a-1d2e3f4a5b6c",
  "payload": {
    "to": ["cliente@oficina.local"],
    "subject": "Seu orçamento está disponível",
    "text": "Olá. O orçamento da sua ordem de serviço está disponível para aprovação.",
    "html": "<p>Olá. O orçamento da sua ordem de serviço está disponível para aprovação.</p>",
    "purpose": "quote_sent"
  }
}
```

### Envelope

| Campo | Tipo | Regra |
| --- | --- | --- |
| `messageId` | string | Obrigatório. UUID versão 4. É o mesmo id que o serviço gravou na tabela de saída de mensagens (*outbox*) e que aparece no log desta função |
| `type` | string | Obrigatório. Precisa ser `notification.email.send` |
| `occurredAt` | string | Obrigatório. Data e hora no formato ISO-8601 com fuso (`Z` ou `-03:00`, por exemplo) |
| `workOrderId` | string ou `null` | Opcional. UUID da OS a que o e-mail se refere; `null` ou ausente nos e-mails de conta |
| `payload` | objeto | Obrigatório |

### Payload

| Campo | Tipo | Regra |
| --- | --- | --- |
| `to` | lista de strings | Obrigatório. Ao menos um destinatário. **Cada item é um único endereço**, com domínio (`maria@example.com`), sem nome de exibição (`Maria <maria@example.com>`), vírgula, `;`, `<`, `>`, aspas ou espaço |
| `subject` | string | Obrigatório. Assunto; não pode ser vazio nem só espaços |
| `text` | string | Obrigatório. Versão em texto puro do e-mail; não pode ser vazio nem só espaços |
| `html` | string | Obrigatório. Versão em HTML do e-mail; não pode ser vazio nem só espaços |
| `purpose` | string | Opcional. O propósito do e-mail — ver abaixo |

`subject`, `text` e `html` precisam ser **texto**. Um objeto no lugar (por
exemplo `{ "path": "/etc/passwd" }` ou `{ "href": "http://..." }`) é recusado,
porque a biblioteca de envio (`nodemailer`) interpretaria o objeto como um
arquivo ou endereço a ler e mandaria o conteúdo dele no e-mail.

O e-mail sai com exatamente esses destinatários, assunto, texto e HTML. O
remetente é sempre o configurado na função (variável `MAIL_FROM`). A função não
escreve nem altera conteúdo.

**Campo a mais no payload é ignorado.** Assim, um serviço pode começar a mandar
um campo novo antes de a função passar a usá-lo, sem que a mensagem seja
recusada.

## O propósito do e-mail

`purpose` é um rótulo que diz que tipo de e-mail é — por exemplo
`staff_initial_password` (senha inicial de funcionário) ou `quote_sent`
(orçamento enviado). Ele vai para o log, para que seja possível saber que tipo de
e-mail falhou sem registrar o conteúdo.

| | |
| --- | --- |
| Obrigatório? | Não |
| Formato aceito | Letras minúsculas sem acento separadas por `_` (expressão `^[a-z]+(_[a-z]+)*$`), até 40 caracteres |
| Quem define os valores | O serviço que monta o e-mail. A função **não tem lista** de valores: um tipo novo de e-mail muda só o serviço |
| Onde aparece | No campo `oficina.notification.purpose` dos dois eventos de log |
| Ausente, não texto ou fora do formato | O log registra `unspecified` |
| Mensagem que nem é JSON válido | O log registra `unspecified` |
| Resto do payload inválido, propósito válido | O log registra o propósito |

**O propósito nunca impede o envio** e nunca é motivo de recusa. O formato não
aceita dígito, `@`, espaço nem letra maiúscula, então um valor válido não
consegue carregar um id, endereço, código ou senha. Um valor fora do formato
nunca vai para o log como veio.

## O que acontece com cada mensagem

| Situação | E-mail enviado? | Mensagem | Evento de log | Motivo registrado |
| --- | --- | --- | --- | --- |
| Mensagem válida e servidor SMTP aceita | sim | confirmada e removida da fila | `notification.sent` | — |
| Corpo não é JSON, envelope inválido ou `type` diferente | não | devolvida à fila | `notification.failed` | `invalid_message` |
| Payload fora das regras acima | não | devolvida à fila | `notification.failed` | `invalid_message` |
| Servidor SMTP recusa, não responde em 2 s ou cai | tentado | devolvida à fila | `notification.failed` | `smtp_error` |

Os motivos são só esses dois: `invalid_message` (o serviço mandou algo errado) e
`smtp_error` (o servidor de e-mail falhou). O texto de erro do servidor SMTP
nunca é registrado, porque costuma repetir o endereço do destinatário.

Uma mensagem devolvida fica invisível na fila durante o *visibility timeout* (30
s) e depois é entregue de novo à função. A SQS conta quantas vezes cada mensagem
foi recebida (`ApproximateReceiveCount`); no quinto recebimento sem sucesso, a
fila move a mensagem para a DLQ `notification-dlq.fifo` (*dead-letter queue*),
onde ela fica guardada por 1 dia para análise. O evento de log diz qual dos dois
caminhos a mensagem vai seguir:

| `oficina.notification.outcome` | Quando |
| --- | --- |
| `sent` | O servidor SMTP aceitou o e-mail |
| `retry` | Falhou, e a mensagem ainda vai ser entregue de novo |
| `dead_lettered` | Falhou no quinto recebimento: a mensagem vai para a DLQ |

Mensagem inválida também percorre as cinco tentativas e chega à DLQ, em vez de
ser descartada: assim ela fica disponível para descobrir o que o serviço mandou
de errado.

## Uma mensagem por execução

A AWS Lambda lê a fila por um *event source mapping* — a configuração que liga
uma fila a uma função. Ele entrega **uma** mensagem por execução da função, com
no máximo 10 execuções ao mesmo tempo — ver
[ADR 0002](adr/0002-uma-mensagem-por-invocacao.md).

A função responde no formato de resposta parcial da AWS Lambda para filas SQS: a
lista `batchItemFailures` com o id, na fila, de cada mensagem que falhou.

```json
{ "batchItemFailures": [{ "itemIdentifier": "<id da mensagem na fila>" }] }
```

Lista vazia confirma todas as mensagens recebidas. A falha de uma mensagem volta
nessa lista, e não como erro da função: mensagem inválida ou servidor de e-mail
fora do ar não são defeito da função.

O código também funciona se receber várias mensagens de uma vez, e mantém a
ordem de cada grupo nesse caso:

- processa as mensagens na ordem recebida;
- quando uma falha, ela **e as seguintes do mesmo `MessageGroupId`** voltam em
  `batchItemFailures` sem serem tentadas e sem registro no log;
- as mensagens de outros grupos continuam sendo processadas.

Só um erro de configuração da função (uma variável de ambiente obrigatória
ausente) faz a execução inteira falhar; nesse caso todas as mensagens recebidas
voltam à fila.

## Entrega pelo menos uma vez

A função não guarda quais e-mails já enviou. Se o servidor SMTP aceita o e-mail e
a função é interrompida antes de responder (por exemplo, ao estourar o tempo
limite de 5 s), a mensagem volta à fila e o e-mail pode sair duas vezes. Isso é
aceito: um e-mail repetido não altera nenhum dado da oficina.

## Limites de responsabilidade

A função entrega e-mail. Ela **não** escolhe destinatário, **não** escreve
assunto, texto ou HTML, **não** traduz, **não** evita duplicatas e **não** avisa
o serviço que pediu sobre o resultado. Uma falha de envio **nunca** desfaz a
operação que pediu o e-mail: o serviço já a concluiu quando publicou o pedido.
