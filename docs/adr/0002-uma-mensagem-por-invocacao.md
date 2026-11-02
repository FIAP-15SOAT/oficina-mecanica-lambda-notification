# ADR 0002: Uma mensagem por execução, com a ordem por grupo garantida no código

## Status

Aceito — 2026-11-02

## Contexto

A AWS Lambda lê a fila `notification.fifo` por um *event source mapping* — a
configuração que liga uma fila a uma função e define quantas mensagens vão em
cada execução e quantas execuções rodam ao mesmo tempo.

A fila é FIFO (*first in, first out*). Nela, cada mensagem tem um grupo
(`MessageGroupId`), e as mensagens de um mesmo grupo são entregues em ordem: a
próxima só sai depois que a anterior é confirmada ou devolvida. Os serviços
agrupam assim:

- o Work Order usa o id da ordem de serviço (OS): os e-mails de uma OS saem na
  ordem em que foram pedidos;
- o Identity, sem OS, usa um grupo por e-mail: os e-mails de conta não esperam
  uns pelos outros.

Outros fatos que pesam:

- Uma mensagem devolvida volta à fila depois do *visibility timeout*, de 30 s.
  No quinto recebimento sem sucesso, a fila a move para a DLQ
  `notification-dlq.fifo` (*dead-letter queue*, onde ficam as mensagens que não
  puderam ser processadas).
- A AWS Lambda roda tantas execuções em paralelo quantos forem os grupos com
  mensagens esperando. Um cadastro de muitos funcionários de uma vez abriria um
  grupo — e potencialmente uma execução — por e-mail.
- A AWS recomenda que o visibility timeout seja pelo menos seis vezes o tempo
  limite da função. Com 30 s na fila, a função fica com 5 s.

A decisão responde a quatro perguntas: quantas mensagens por execução; como
manter a ordem de um grupo quando uma mensagem falha; quantas execuções ao mesmo
tempo; e o que fazer com uma mensagem inválida.

## Decisão

### 1. Uma mensagem por execução

O mapping usa `batch_size = 1` e `function_response_types =
["ReportBatchItemFailures"]` (a função devolve a lista das mensagens que
falharam, e as demais são confirmadas). Assim, uma falha segura só o próprio
grupo, e os 5 s sempre bastam: há um único envio, e cada etapa SMTP tem no
máximo 2 s. A falha volta na lista `batchItemFailures`, e não como erro da
função.

### 2. A ordem por grupo também no código

A função continua aceitando várias mensagens numa execução. Ela as processa em
ordem e, quando uma falha, devolve essa mensagem **e as seguintes do mesmo
grupo** sem tentá-las, e continua com as de outros grupos. Assim a ordem dentro
do grupo não depende do `batch_size` configurado no Terraform.

### 3. No máximo 10 execuções ao mesmo tempo, sem reserva

O mapping usa `scaling_config { maximum_concurrency = 10 }`, como limite de
segurança. No uso normal, rodam 1 ou 2 execuções ao mesmo tempo; o limite só age
numa rajada, que ele esvazia em um ou dois segundos. A cota da conta AWS
comporta: de 1000 execuções simultâneas, a customer-auth (a outra função Lambda
da solução) reserva 10, e esta função, usando até 10, deixa 980 para as demais.

A função **não** tem concorrência reservada (uma parte da cota separada só para
ela). Uma reserva menor que o limite do mapping faria a AWS recusar execuções, e
cada mensagem recusada conta como um recebimento a caminho da DLQ. O
`maximum_concurrency` só segura a leitura da fila, sem recusar nada.

### 4. Mensagem inválida volta à fila até a DLQ

Uma mensagem com envelope ou payload inválido volta como falha, com o evento
`notification.failed` e o motivo `invalid_message` em cada tentativa, e chega à
DLQ depois do quinto recebimento. É o mesmo tratamento que os serviços dão às
mensagens que consomem, e deixa a mensagem guardada para descobrir o que o
serviço mandou de errado. O log diferencia a última tentativa (`dead_lettered`)
das anteriores (`retry`).

## Alternativas consideradas

| Alternativa | A favor | Contra | Decisão |
| --- | --- | --- | --- |
| 10 mensagens por execução, parando no primeiro erro (a recomendação da AWS para filas FIFO com resposta parcial) | Menos execuções | As mensagens de outros grupos devolvidas junto com uma falha que se repete contam recebimentos sem serem tentadas e podem acabar na DLQ — o que atinge em cheio os e-mails do Identity, um grupo por e-mail. Com o MailHog lento, dez envios não cabem em 5 s, e o estouro do tempo devolve todas as mensagens, reenviando as que já tinham saído | Rejeitada |
| 10 mensagens por execução, com a regra por grupo no código | Resolve a DLQ indevida | Não resolve o tempo: dez envios podem não caber em 5 s | Rejeitada |
| 1 mensagem por execução, sem a regra por grupo no código | Menos código | A ordem dos e-mails de um grupo dependeria só de um número no Terraform; aumentá-lo reordenaria e-mails sem nenhum teste falhar | Rejeitada |
| Limite de 2 execuções simultâneas, o mínimo que a AWS aceita | Protege um pouco mais a cota da conta | Não protege nada que o limite de 10 não proteja, e uma rajada de 50 e-mails levaria uns 8 s em vez de 1 a 2 s | Rejeitada |
| Sem limite | Vazão máxima | Um serviço com defeito poderia abrir uma execução por grupo, até esgotar a cota livre da conta | Rejeitada |
| Concorrência reservada na função | Capacidade garantida | Abaixo do limite do mapping, a AWS recusaria execuções e mandaria mensagens para a DLQ; e a reserva tira da cota algo que nenhuma outra função usaria | Rejeitada |
| Descartar a mensagem inválida (confirmar sem enviar) | A DLQ teria só falhas do servidor de e-mail | O pedido sumiria, deixando só uma linha de log; um serviço com defeito não seria notado pela DLQ | Rejeitada |

## Consequências

**Positivas.** Um e-mail com problema não atrasa nem embaralha os de outros
grupos, e dentro de um grupo a ordem vale para qualquer número de mensagens por
execução. O envio sempre cabe no tempo limite. Nada chega à DLQ sem ter sido
tentado cinco vezes, e o que está lá pode ser analisado.

**Negativas.** Uma execução por e-mail, mais que com várias mensagens por
execução — sem custo relevante no volume da oficina. Uma mensagem inválida gera
cinco linhas de `notification.failed` antes de chegar à DLQ.

**Aceitas.** Se a função estourar o tempo depois de o servidor aceitar o e-mail,
a mensagem volta e o e-mail pode sair duas vezes — cada e-mail é entregue pelo
menos uma vez.

## Revisar se

- o volume exigir enviar os e-mails de um mesmo grupo mais rápido que um por
  vez; ou
- a quantidade real de e-mails chegar perto do limite de 10 execuções.

## Referências

- [Contrato › Uma mensagem por execução](../contracts.md#uma-mensagem-por-execução)
- [Arquitetura › Fluxo de uma execução](../architecture.md#fluxo-de-uma-execução)
- [Infraestrutura › Configuração da função](../terraform.md#configuração-da-função)
- [AWS › Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
