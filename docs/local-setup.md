# Como executar localmente

## Pré-requisitos

| Ferramenta | Versão | Necessária para |
| --- | --- | --- |
| Node.js | 24 ou superior | Tudo |
| Docker | — | Subir o MailHog local e rodar os testes de ponta a ponta |

**Nenhuma credencial AWS é necessária.** Localmente não há fila: o comando
`npm run invoke` entrega uma mensagem de exemplo direto à função.

## Primeiro uso

```bash
# Instalar as dependências na pasta da aplicação
cd app
npm ci
# Criar a configuração local a partir do exemplo
cp .env.example .env
```

O `.env.example` já aponta o envio de e-mail para `127.0.0.1:1025`, onde o
MailHog local vai escutar. O `.env` não é versionado.

## Subir o MailHog

O MailHog é um servidor SMTP de teste: aceita os e-mails, guarda-os em memória e
os mostra numa caixa de entrada web, sem entregá-los a ninguém.

```bash
# Receber SMTP na porta 1025 e mostrar os e-mails em http://localhost:8025
docker run -d --rm --name mailhog -p 1025:1025 -p 8025:8025 mailhog/mailhog:v1.0.1
```

É a mesma versão que roda no cluster e nos testes de ponta a ponta. Para parar,
`docker stop mailhog`; o `--rm` apaga o contêiner e os e-mails guardados.

## Executar a função

```bash
# Executar uma vez com a mensagem de exemplo de events/notification.event.json
npm run invoke
```

O comando (`app/scripts/invoke.ts`) chama o **ponto de entrada real** da função
uma vez, com um evento no mesmo formato que a AWS Lambda entrega quando lê a
fila, e imprime a resposta:

```json
{
  "batchItemFailures": []
}
```

`batchItemFailures` é a lista de mensagens que falharam; vazia, o e-mail foi
aceito. Ele aparece em `http://localhost:8025`, e o terminal mostra a linha de
log `notification.sent` — sem assunto, texto, HTML nem destinatário.

### Outro cenário

O arquivo de exemplo é um evento da AWS Lambda com uma mensagem da fila. O campo
`body` dessa mensagem contém o pedido de e-mail, em JSON escrito como texto
(com as aspas escapadas). Para testar outro caso, copie o arquivo para fora do
repositório, altere o `body` e passe o caminho:

```bash
# Executar com um evento próprio
npm run invoke -- /caminho/para/meu-evento.json
```

Com `to` vazio, por exemplo, a resposta traz a mensagem em `batchItemFailures` e
o log registra `notification.failed` com o motivo `invalid_message`. Com o
MailHog parado, o motivo é `smtp_error`.

Para depurar, rode `NODE_OPTIONS=--inspect npm run invoke` e conecte o
depurador do editor.

## Testes de ponta a ponta com LocalStack

A execução local não usa fila. Tópico e filas só existem nos testes de ponta a
ponta, que usam o **LocalStack** — um emulador local dos serviços da AWS, aqui o
SNS e a SQS — e o MailHog, ambos em contêineres que o Testcontainers sobe e
derruba durante o teste. O script `app/localstack/init-topology.sh`, o mesmo do
repositório de mensageria, cria o tópico `oficina-events.fifo`, a fila
`notification.fifo` e a DLQ. O teste publica um pedido no tópico, lê a fila e
chama a função:

```bash
# Rodar os testes de ponta a ponta; exige o Docker em execução
npm run test:e2e
```

Esses testes não usam o MailHog subido acima: sobem o próprio, em portas livres.

## Gerar o pacote

```bash
# Gerar dist/handler.js e o mapa de origem dist/handler.js.map
npm run build
```

O `.zip` publicado na AWS não é gerado aqui: o Terraform de [`infra/`](../infra/)
compacta `app/dist` na hora de aplicar — ver
[ADR 0003](adr/0003-camadas-enxutas-e-empacotamento.md).

## Variáveis de ambiente

Todas estão em `app/.env.example`.

| Variável | Obrigatória | Padrão | O que faz |
| --- | --- | --- | --- |
| `NODE_ENV` | sim | — | `development`, `test` ou `production`; aparece no log e no span como `deployment.environment.name` |
| `LOG_LEVEL` | não | `info` | Nível mínimo do log: `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | não | — | Endereço que recebe os spans por OTLP/HTTP (o protocolo de envio do OpenTelemetry); na AWS, `http://localhost:4318`, a extensão do Datadog que roda ao lado da função. O span é o registro do processamento de cada mensagem, ligado ao pedido que a originou. Vazia ou ausente, a função não envia span |
| `OTEL_SERVICE_NAME` | não | `oficina-mecanica-lambda-notification` | Nome do serviço no log e no span (`service.name`) |
| `OTEL_SERVICE_NAMESPACE` | não | `oficina-mecanica` | Grupo do serviço no log e no span (`service.namespace`) |
| `SERVICE_VERSION` | não | `dev` | Versão no log e no span (`service.version`); na AWS, o CD grava o commit implantado |
| `SMTP_HOST` | sim | — | Endereço do servidor SMTP |
| `SMTP_PORT` | sim | — | Porta do servidor SMTP (1 a 65535) |
| `MAIL_FROM` | sim | — | Remetente de todo e-mail, por exemplo `"Oficina Mecânica <noreply@oficina.local>"` |

Se uma variável obrigatória faltar ou for inválida, a função não consegue montar
as dependências: registra `app.configuration.invalid` com o nome de cada
variável com problema, a execução falha e as mensagens voltam à fila. A execução
seguinte tenta de novo — ver
[Arquitetura › Montagem das dependências](architecture.md#montagem-das-dependências).
