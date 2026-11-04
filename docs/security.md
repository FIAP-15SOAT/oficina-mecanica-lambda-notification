# Segurança

Ninguém se conecta a esta função: só a AWS Lambda a executa, a partir da fila. O
risco dela é outro — ela **transporta** o dado mais sensível que os serviços
mandam por e-mail.

## Dado sensível em trânsito

Um e-mail pode conter a senha inicial de um funcionário ou um código de
redefinição de senha. Esse dado existe só dentro da mensagem:

| Onde | Proteção |
| --- | --- |
| Filas `notification.fifo` e `notification-dlq.fifo` | Criptografadas em disco pela própria SQS (SSE, *server-side encryption*) |
| Mesmas filas | Guardam as mensagens por **1 dia**, menos que as outras filas da solução |
| Função | Só em memória, durante o envio |
| Log | **Nunca** — ver abaixo |
| Span, o registro do processamento de cada mensagem que a função envia ao APM do Datadog (a parte que mostra os traces, o caminho de um pedido entre os serviços) | **Nunca**: só os ids da mensagem e da ordem de serviço, o propósito, o resultado e o tipo do erro; ver [O que nunca entra no span](observability.md#o-que-nunca-entra-no-span) |
| MailHog | Guarda os e-mails em memória; é um servidor de teste, não uma caixa de e-mail real |

A criptografia e a retenção são configuradas no repositório de mensageria
(`oficina-mecanica-infra-messaging`), que é dono das filas.

## Riscos tratados

| Risco | Como acontece | O que impede |
| --- | --- | --- |
| Conteúdo do e-mail no log | Uma linha de log com assunto, texto, HTML ou endereço | Esses dados não estão na lista de campos de log permitidos; um teste confere que não aparecem |
| Destinatário no log pela resposta do servidor | O servidor responde `550 <maria@example.com>: ...` | O adaptador SMTP troca o erro original por `EmailDeliveryException`, sem o texto do servidor; o log registra só o motivo `smtp_error` |
| Destinatário no span pela resposta do servidor | O mesmo `550 <maria@example.com>: ...` | O span recebe só o motivo `smtp_error`, no atributo `error.type`, sem descrição de status, evento nem exceção; um teste confere que nem o conteúdo do e-mail nem o texto do erro aparecem no span |
| Conteúdo no log pelo propósito | O serviço escreve algo indevido em `purpose` | Só um valor de letras minúsculas separadas por `_` vai ao log; qualquer outro vira `unspecified` |
| Envio de um arquivo do servidor por e-mail | `html` ou `text` como `{ "path": ... }` ou `{ "href": ... }`, que o `nodemailer` leria | A validação exige texto; a mensagem é recusada com `invalid_message`. O transporte também não lê arquivo nem URL |
| E-mail para destinatário não conferido | `to` com vírgula, `;` ou nome de exibição, que o `nodemailer` dividiria em vários endereços | Cada item precisa ser um único endereço |
| Serviço com defeito enchendo a fila | Muitas mensagens de uma vez | No máximo 10 execuções ao mesmo tempo; o volume aparece em `notification.sent` e as falhas, na DLQ |
| E-mail repetido | A função é interrompida depois de o servidor aceitar o e-mail | Aceito: cada e-mail é entregue pelo menos uma vez, e uma repetição não altera dados |

## Conteúdo fora do log

O conteúdo nunca chega ao logger: o ponto de entrada passa ao log só o tipo, o
propósito, a quantidade de destinatários, o resultado e o motivo. A lista de
campos permitidos descarta qualquer outro campo, e a limpeza de texto livre
remove segredos e mascara dados pessoais numa mensagem de exceção — uma segunda
proteção, não a principal. Detalhes em
[Logging](logging.md#o-que-nunca-é-registrado).

O destinatário também não é registrado **mascarado** (`m***@example.com`): seria
ainda um dado pessoal parcial e não serviria para encontrar os e-mails de uma
pessoa. Para rastrear um e-mail há o propósito, a OS, o `trace_id` e o id da
mensagem.

## Só texto no conteúdo

A validação aceita `to` como lista de textos e `subject`, `text` e `html` como
texto. Nesses mesmos campos, o `nodemailer` aceitaria um objeto apontando para
um arquivo local ou uma URL, e leria o conteúdo para colocá-lo no e-mail. Um
serviço com defeito, ou uma mensagem forjada na fila, poderia assim mandar por
e-mail um arquivo do ambiente da função ou a resposta de um endereço interno da
rede. A mensagem é recusada antes do envio, e um teste cobre os dois casos.
Além disso, o transporte do `nodemailer` é criado com a leitura de arquivo e de
URL desligada (opções `disableFileAccess` e `disableUrlAccess`): se um objeto
passasse pela validação, o envio falharia em vez de ler o conteúdo.

## Rede

O security group da função — o firewall da AWS associado a ela — não aceita
nenhuma conexão de entrada e libera a saída. Pela saída a função alcança a porta
1025 do balanceador de carga de rede (NLB) interno, que leva ao MailHog, e o
Datadog. O SMTP até o MailHog é **sem TLS** e não sai da VPC: o MailHog do
cluster não oferece TLS, e o destino é um ambiente de demonstração, não um
provedor de e-mail real.

## Nenhuma credencial na função

A função não lê banco de dados nem segredo. Suas variáveis de ambiente são só o
endereço do servidor SMTP, o remetente e a versão. O MailHog não pede usuário e
senha. A permissão de execução da função é uma role IAM que já existe na conta,
lida pelo Terraform, que não a cria nem a altera.

A exceção é a chave do Datadog, quando a coleta está ligada.

## A chave do Datadog fica visível na configuração da função

A chave vai como variável de ambiente da função. Quem puder ler a configuração
da função na AWS consegue lê-la, e ela fica gravada no state do Terraform (a
marcação `sensitive` só a esconde da saída dos comandos). A customer-auth faz o
mesmo, e nos serviços a mesma chave fica num Secret do Kubernetes, legível por
quem lê o namespace. O Datadog recomenda guardar a chave no Secrets Manager e
passar só a referência; isso acrescentaria um recurso e uma leitura a cada
partida a frio, e não reduziria o acesso nesta conta, em que a role usada já
tem permissões amplas.

## Repositório público

1. **Nenhum dado sensível é versionado.** `.env`, `terraform.tfvars` e `*.pem`
   estão no `.gitignore`; o `app/.env.example` só tem valores de exemplo.
2. **A prévia do Terraform no CI usa credenciais AWS** num workflow disparado
   por `push` em branch de trabalho, e o resultado vai para um log público.
   Aceito, pelos motivos de
   [CI/CD › Exposição aceita conscientemente](ci-cd.md#exposição-aceita-conscientemente).
3. **Pull Request vindo de fork não recebe segredos**, por regra do GitHub.
