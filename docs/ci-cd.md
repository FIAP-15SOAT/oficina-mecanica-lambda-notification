# CI/CD

A esteira roda no GitHub Actions, em três workflows independentes: integração
contínua (CI), análise estática de segurança e qualidade (SAST) e entrega
contínua (CD). O código da aplicação fica em `app/` e o Terraform em `infra/`,
como nos serviços e na customer-auth, a outra função Lambda da solução.

| Workflow | Arquivo | Quando roda | Termina em |
| --- | --- | --- | --- |
| CI | `.github/workflows/ci.yml` | `push` em branches `feature/**` e `fix/**` | Pull Request aberto para a `main` |
| SAST | `.github/workflows/sast.yml` | Pull Request para a `main` e `push` na `main` | Resultado do portão de qualidade (*quality gate*) do SonarQube Cloud |
| CD | `.github/workflows/cd.yml` | `push` na `main` e execução manual (opção `action`: `apply`, o padrão, ou `destroy`) | E-mail de teste conferido no MailHog do cluster, ou recursos da função removidos com `action=destroy` |

## Integração contínua

O CI roda em todo `push` numa branch `feature/**` ou `fix/**`, e **não** no
evento de Pull Request: rodar nos dois duplicaria cada execução. Um `push` novo
na mesma branch cancela a execução anterior. Uma branch com outro nome não roda o
CI e, como a `main` exige as verificações dele, não consegue fazer merge: esse é
o controle do nome das branches.

Seis verificações rodam em paralelo. Se todas passam, um bot — um GitHub App da
organização — abre o Pull Request para a `main`.

| Job | O que prova | O que o reprova |
| --- | --- | --- |
| `Lint` | O código segue a formatação e as regras de importação entre camadas | Formatação diferente, ou `domain/`/`application/` importando infraestrutura |
| `Type Check` | O código não tem erro de tipo | Erro de tipo. É um job separado porque o `esbuild`, que gera o pacote, remove os tipos **sem verificá-los**: sem este job, um erro de tipo seria publicado |
| `Unit Tests` | Os testes unitários passam com cobertura total | Teste falhando, ou cobertura abaixo de 100% em linhas, instruções, funções ou ramos |
| `E2E Tests` | Um pedido publicado no tópico vira e-mail no MailHog, com LocalStack e MailHog em contêineres | E-mail que não chega, ou mensagem inválida que gera e-mail |
| `Package` | O pacote gerado carrega e cabe no limite de upload da AWS Lambda | Atalho de importação não resolvido, dependência fora do pacote, ou `.zip` acima de 50 MiB |
| `Terraform Validation` | O Terraform está formatado e válido e, quando há credenciais AWS válidas, mostra o plano | Formatação diferente, configuração inválida, ou plano que roda e falha |
| `Open Pull Request` | — | Só abre o PR; não é verificação |

Os jobs começam pelo checkout do código e, quando precisam do Node, pela ação
local `.github/actions/setup-ci`, que instala o Node 24 com cache do npm e roda
`npm ci` em `app/`. Os jobs só têm permissão de leitura no repositório (o
`GITHUB_TOKEN` com `contents: read`); o PR é aberto com um token temporário do
GitHub App.

### Steps de cada job

`Lint`, `Type Check` e `Unit Tests` têm três steps: checkout, `Setup CI` e o
comando (`npm run lint`, `npm run typecheck` ou `npm run test:cov`).

#### `E2E Tests`

| # | Step | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Baixa o código do commit |
| 2 | Setup CI | Node 24, cache do npm e `npm ci` em `app/` |
| 3 | E2E tests against LocalStack and MailHog | `npm run test:e2e`: os contêineres sobem no Docker da máquina do GitHub, sem clonar outro repositório |

#### `Package`

| # | Step | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Baixa o código do commit |
| 2 | Setup CI | Node 24, cache do npm e `npm ci` em `app/` |
| 3 | Build | `npm run build` gera `app/dist`; falha se sobrar um atalho de importação |
| 4 | Load the entry point with no dependencies installed | Copia `handler.js` para uma pasta temporária fora do repositório, sem `node_modules`, carrega o arquivo e exige que ele exporte a função `handler` |
| 5 | Check the package against the direct upload limit | Compacta `dist/` e falha se o `.zip` passar de 50 MiB, o limite de upload direto da AWS Lambda |

A pasta fora do repositório importa: o Node procura dependências subindo pelas
pastas, e dentro do repositório encontraria o `node_modules` instalado, e o
teste passaria mesmo com uma dependência faltando no pacote. As três
dependências de execução (`nodemailer`, `pino`, `zod`) vão dentro do pacote.

#### `Terraform Validation`

| # | Step | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Baixa o código do commit |
| 2 | hashicorp/setup-terraform | Instala o Terraform |
| 3 | Terraform Fmt Check | `terraform fmt -check -recursive` |
| 4 | Terraform Init Lambda Notification | `terraform init -backend=false -no-color`: baixa os providers sem acessar o state |
| 5 | Terraform Validate Lambda Notification | `terraform validate -no-color` |
| 6 | Setup CI | Node 24, cache do npm e `npm ci` em `app/` |
| 7 | Build the package for the plan | Gera `app/dist`, que o Terraform compacta |
| 8 | Configure AWS Credentials | Configura as credenciais AWS; se falharem (expiradas, por exemplo), o job continua sem o plano |
| 9 | Terraform Plan Lambda Notification | Só com credenciais válidas: `init` com o state remoto e `plan`, que lê os states das três stacks de origem; um erro reprova o job |
| 10 | Note skipped plan in job summary | Só sem credenciais: registra no resumo da execução que o plano foi pulado |

#### `Open Pull Request`

Roda depois que os seis jobs passam. Gera o token do GitHub App e abre o PR para
a `main`, se ainda não houver um aberto para a branch.

## Análise estática (SAST)

O SonarQube Cloud analisa o código em busca de bugs, vulnerabilidades e trechos
problemáticos, e mede a cobertura de testes. O portão de qualidade é o conjunto
de critérios que a análise precisa cumprir.

| # | Step | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Baixa o código com o histórico completo (`fetch-depth: 0`), que o SonarQube usa para identificar o código novo |
| 2 | Setup CI | Node 24, cache do npm e `npm ci` em `app/` |
| 3 | Unit tests with coverage | `npm run test:cov` gera o relatório de cobertura `app/coverage/lcov.info` na mesma execução |
| 4 | SonarQube Scan | `sonarqube-scan-action` v8.3.0 analisa `app/` com o `SONAR_TOKEN` e espera o resultado do portão de qualidade |

Só a cobertura dos testes **unitários** vai ao SonarQube Cloud: é ela que deve
estar em 100%. `sonar.qualitygate.wait=true`, em `app/sonar-project.properties`,
faz o step falhar quando o portão reprova. Uma análise nova do mesmo PR cancela
a anterior. O SAST não depende do CI nem do CD; por ser verificação obrigatória
da `main`, uma análise reprovada bloqueia o merge.

## Entrega contínua

### Condições para rodar

1. **O commit é da `main`.** A condição fica no job: um job que não roda não
   recebe segredo nenhum.
2. **A variable `ENABLE_DEPLOY` está em `true`, ou a execução é manual.** A
   execução manual ignora a variable, para aplicar sob demanda. Uma execução
   pulada porque a variable está desligada **não é falha**.
3. **Com a coleta do Datadog ligada, o segredo `DD_API_KEY` existe.** O step
   `Validate required secrets` falha antes de qualquer chamada à AWS: uma
   extensão do Datadog sem chave não enviaria nada.

Execuções do CD formam uma fila única (grupo de concorrência `production`) e
nunca se interrompem: um `apply` em andamento sempre termina. Se várias
execuções chegarem enquanto uma roda, só a mais recente espera; as
intermediárias são descartadas.

### Dois jobs

| Job | O que faz | Quando roda |
| --- | --- | --- |
| `Deploy Lambda` | Gera o pacote e aplica o Terraform (`apply`) ou remove os recursos (`action=destroy`) | Quando as condições acima são atendidas |
| `Post-Deploy Gates` | Verifica que a função publicada entrega e-mail | Depois de `Deploy Lambda` com sucesso, e nunca em `destroy` |

São dois jobs para que uma falha seja lida certo: se a verificação falha, a
função **foi** publicada — o que falhou foi a verificação, e a correção é para a
frente (consertar o MailHog, por exemplo), não reverter.

#### `Deploy Lambda`

| # | Step | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Baixa o código do commit |
| 2 | Validate required secrets | Fora do `destroy`: com `ENABLE_TELEMETRY_COLLECTION=true`, exige `DD_API_KEY` |
| 3 | Setup CI | Node 24, cache do npm e `npm ci` em `app/` |
| 4 | Build | Gera `app/dist`, que o Terraform compacta — também no `destroy`, porque o Terraform lê a pasta |
| 5 | hashicorp/setup-terraform | Instala o Terraform |
| 6 | Configure AWS Credentials | Credenciais AWS em `us-east-1` |
| 7 | Terraform Init | Conecta ao state no S3 com `-backend-config="bucket=$TF_STATE_BUCKET"` |
| 8 | Terraform Validate | `terraform validate -no-color` |
| 9 | Terraform Plan | Fora do `destroy`; passa o commit como `service_version`, a coleta e a chave do Datadog |
| 10 | Terraform Apply | Fora do `destroy`, com as mesmas variáveis; publica uma versão nova da função quando algo mudou |
| 11 | Terraform Destroy | Só com `action=destroy`: remove a função, a ligação com a fila, o security group e o grupo de log |
| 12 | Read stack outputs | Fora do `destroy`: lê `function_name`, `function_version` e `queue_arn` |
| 13 | Record the deployment in the job summary | Registra função, versão, fila, commit e coleta no resumo; roda mesmo depois de uma falha |

#### `Post-Deploy Gates`

| # | Step | O que faz |
| --- | --- | --- |
| 1 | Configure AWS Credentials | Credenciais AWS em `us-east-1` |
| 2 | Post-deploy gate — real invocation | Executa a função com uma mensagem de teste e exige `batchItemFailures` vazio |
| 3 | Post-deploy gate — delivered e-mail | Procura o e-mail de teste no MailHog do cluster |

### As duas verificações depois do deploy

**1. Executar a função publicada.** O step monta com `jq` um evento igual ao que
a AWS Lambda entrega quando lê a fila, com uma mensagem `notification.email.send`
válida: destinatário `post-deploy-gate@oficina.local`, assunto
`post-deploy-gate-<id da execução do workflow>`, `purpose` igual a
`post_deploy_gate`, sem OS e sem `traceparent`. A mensagem não passa pela fila:
o step chama a função direto, com `aws lambda invoke`.

| Resultado | Significa |
| --- | --- |
| `batchItemFailures` vazio | O pacote carregou, a configuração é válida e o servidor SMTP aceitou o e-mail — **é o esperado** |
| `FunctionError` na resposta do `aws lambda invoke` | A função nem chegou a responder: pacote ou configuração quebrados; a causa está no grupo de log da função |
| `batchItemFailures` com a mensagem | O envio falhou; o motivo está na linha `notification.failed` do grupo de log |

**2. Conferir o e-mail no MailHog.** O step configura o `kubectl` para o cluster
EKS (variable `EKS_CLUSTER_NAME`), abre um túnel até a interface do MailHog com
`kubectl port-forward -n platform svc/mailhog 8025:8025` e procura o assunto do
e-mail de teste na API do MailHog, em até 15 tentativas com 2 s entre elas.
Prova que o e-mail passou pelo NLB e chegou, e não só que saiu da função.

### Rastreabilidade e reversão

O commit implantado vai para a variável `SERVICE_VERSION` da função — que aparece
como `service.version` em toda linha de log — e para a tag `ServiceVersion`.
Para desfazer uma entrega, reverta o commit na `main` e deixe o CD rodar: o build
gera sempre o mesmo pacote para o mesmo código.

## Configuração do GitHub

Segredos e variables vêm de três lugares no GitHub: a organização, o repositório
e o *environment* `production` (um conjunto de configurações que só jobs que o
declaram recebem).

### Da organização

| Nome | Tipo | Workflow | Para quê | Obrigatório |
| --- | --- | --- | --- | --- |
| `AWS_ACCESS_KEY_ID` | Segredo | CI, CD | Credenciais AWS | CD: sim · CI: não (sem elas, o plano é pulado) |
| `AWS_SECRET_ACCESS_KEY` | Segredo | CI, CD | Credenciais AWS | CD: sim · CI: não |
| `AWS_SESSION_TOKEN` | Segredo | CI, CD | Credenciais AWS. **Sem ele, toda chamada falha com token inválido** | CD: sim · CI: não |
| `TF_STATE_BUCKET` | Variable | CI, CD | Nome do bucket dos states: vai ao `terraform init` e às três `TF_VAR_*_state_bucket` | Sim |
| `BOT_APP_ID` | Variable | CI | Id do GitHub App que abre o PR | Sim |
| `BOT_PRIVATE_KEY` | Segredo | CI | Chave do mesmo GitHub App | Sim |
| `DD_API_KEY` | Segredo | CD | Chave do Datadog, a mesma dos serviços | Só com a coleta ligada |

### Do repositório

| Nome | Tipo | Workflow | Para quê | Obrigatório |
| --- | --- | --- | --- | --- |
| `SONAR_TOKEN` | Segredo | SAST | Acesso ao SonarQube Cloud | Sim |
| `ENABLE_DEPLOY` | Variable | CD | Liga a entrega automática a cada `push` na `main`. Precisa ser do repositório, porque a condição do job é avaliada antes de o environment ser carregado | Não (ausente = desligada) |
| `ENABLE_TELEMETRY_COLLECTION` | Variable | CD | Liga a extensão do Datadog | Não (ausente = desligada) |
| `EKS_CLUSTER_NAME` | Variable | CD | Nome do cluster da segunda verificação (`eks-oficina-mecanica`) | Sim, para a segunda verificação |

O job `Deploy Lambda` declara o environment `production`, que não tem segredo
próprio: esta função não tem chave de assinatura nem senha.

### Passos manuais

1. Criar o environment `production` e as variables do repositório.
2. Incluir o repositório no GitHub App que abre os PRs.
3. Criar o projeto `FIAP-15SOAT_oficina-mecanica-lambda-notification` na
   organização `fiap-15soat` do SonarQube Cloud e gravar o `SONAR_TOKEN`. Como o
   SAST é verificação obrigatória, sem o projeto nenhum PR consegue fazer merge.
4. Confirmar que a role IAM `LabRole` existe na conta e pode ser usada pela AWS
   Lambda, e que as credenciais do CD podem criar função, event source mapping,
   security group e grupo de log.

### Exposição aceita conscientemente

O plano do Terraform no job `Terraform Validation` usa credenciais AWS num
workflow disparado por `push` em branch de trabalho, **num repositório público**.
Quem pode fazer `push` no repositório pode alterar o workflow na própria branch
e usar as credenciais, e o resultado do plano vai para um log público.

Isso é aceito por três motivos: PR vindo de fork não recebe segredos; as
credenciais AWS expiram a cada reinício da sessão; e o plano no PR é o único
momento em que a mudança de infraestrutura é revisada **antes** do merge, como
nos repositórios de infraestrutura da solução.

## Solução de problemas

### Credenciais AWS expiradas

**Sintoma.** No CI, o plano é pulado e o resumo registra isso — o job passa. No
CD, a autenticação falha.

**Correção.** Renovar `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e
`AWS_SESSION_TOKEN` na organização, **os três juntos**.

### Ambiente desligado

**Sintoma.** O CD é pulado e aparece como bem-sucedido sem ter criado nada; ou,
com a entrega ligada, o `plan` falha ao ler o state de outra stack.

**Causa.** `ENABLE_DEPLOY` não está em `true` — comportamento esperado —, ou o
infra-k8s e o infra-messaging não estão aplicados, e os states deles não têm
`smtp_listener_port` ou `queue_arns`.

**Correção.** Aplicar as stacks na ordem de
[Infraestrutura › Ordem de aplicação](terraform.md#ordem-de-aplicação) e ligar a
variable, ou executar o CD manualmente.

### MailHog fora do ar

**Sintoma.** A primeira verificação falha com `batchItemFailures` não vazio e
`notification.failed` com `smtp_error` no grupo de log; ou a primeira passa e a
segunda não encontra o e-mail.

**Causa.** A porta 1025 do NLB interno não tem destino saudável: o pod do MailHog
no namespace `platform` não está rodando, ou a porta 31025 dos nós do cluster
(o NodePort do MailHog) não responde.

**Correção.** Conferir `kubectl get pods -n platform` e a saúde do target group
SMTP do NLB no console da AWS. A função está correta, e reverter não resolve.
Com o MailHog de volta, executar o CD de novo.

### Trava de state esquecida

**Sintoma.** `terraform init` ou `apply` falha dizendo que o state está travado.

**Correção.** Confirmar que nenhuma execução está em andamento e remover a trava
com `terraform force-unlock <id>`, usando o id da mensagem de erro.

## Regras da `main`

O ruleset da `main` — o conjunto de regras de proteção da branch no GitHub —
recusa `push` direto, reescrita de histórico e exclusão da branch, e exige Pull
Request, sem exceção para ninguém, administradores inclusive. Para fazer merge,
estas verificações precisam passar, com estes nomes exatos:

```
Lint · Type Check · Unit Tests · E2E Tests · Package · Terraform Validation · SAST
```

`Open Pull Request` **não** entra: não é verificação. Um nome diferente do que o
job produz deixa o PR esperando para sempre. O merge é sempre feito por uma
pessoa.
