# ADR 0003: Camadas enxutas e empacotamento iguais aos da Lambda customer-auth

## Status

Aceito — 2026-11-02

## Contexto

Esta é a segunda função AWS Lambda da solução. A primeira, a **customer-auth**
(`oficina-mecanica-lambda-customer-auth`), autentica clientes por CPF e senha, e
já definiu como uma função é organizada aqui:

- Clean Architecture com quatro camadas (`domain`, `application`,
  `interface-adapters`, `infrastructure`), sem framework;
- dependências montadas uma vez por ambiente de execução e reaproveitadas
  (`bootstrap.ts`);
- o código de logging copiado dos serviços;
- o pacote gerado pelo `esbuild` num arquivo único, e o `.zip` montado pelo
  Terraform.

Essas decisões estão nos ADRs 0002 e 0004 da customer-auth. Os serviços da
solução, por outro lado, usam NestJS, um framework com módulos e injeção de
dependências. A decisão é qual dos dois padrões esta função segue.

## Decisão

**Seguir a customer-auth**, trocando só o domínio.

- **Quatro camadas, sem framework.** `domain` (`EmailMessage`), `application`
  (`SendEmailUseCase` e as interfaces), `interface-adapters`
  (`SendEmailController`) e `infrastructure` (leitura da fila, SMTP, logging e
  configuração). As regras do ESLint que impedem uma camada interna de importar
  infraestrutura são as mesmas, com o `nodemailer` no lugar das bibliotecas da
  customer-auth.
- **Dependências montadas uma vez, de forma síncrona,** em `src/bootstrap.ts`.
  Não há segredo a buscar nem conexão a abrir, então, diferente da customer-auth,
  nada é preparado antes da primeira mensagem. Uma montagem que falha é tentada
  de novo na execução seguinte.
- **Um único arquivo JavaScript gerado pelo `esbuild`**, com as dependências
  dentro. O build falha se sobrar um atalho de importação, e o job `Package` do
  CI carrega o arquivo sem `node_modules`.
- **O `.zip` montado pelo `archive_file` do Terraform** a partir de `app/dist`,
  no mesmo job que aplica, com as permissões dos arquivos fixadas. Cada mudança
  publica uma versão numerada da função; para desfazer, reverte-se o commit; o
  commit implantado vai para `SERVICE_VERSION`.

## Alternativas consideradas

**NestJS na função**, o mesmo framework dos serviços, com módulos, injeção de
dependências e o módulo de e-mail do NestJS.

- A favor: um padrão só para serviços e funções; o módulo de e-mail do NestJS
  também usa o `nodemailer`.
- Contra: pacote maior e partida a frio (a primeira execução de um ambiente
  novo) mais lenta, por carregar o framework, para uma função que recebe um
  evento e devolve uma lista.
- Contra: módulos e provedores existem para o framework funcionar; aqui seriam
  estrutura sem necessidade, e o `bootstrap.ts` já faz o que a injeção de
  dependências faria.

Rejeitada.

**Criar a estrutura do zero.** Não há o que ganhar: a customer-auth já resolveu
empacotamento, regras de importação e logging, e duas funções organizadas de
jeitos diferentes custam mais a quem trabalha nas duas.

Rejeitada.

## Consequências

**Positivas.** Quem conhece a customer-auth encontra as mesmas coisas nos mesmos
lugares. O pacote é pequeno e carrega sem dependências instaladas. A regra do
e-mail é testável sem fila nem servidor SMTP.

**Negativas.** O código de logging passa a existir em três cópias (serviços,
customer-auth e esta função), e uma correção nele precisa ser repetida — a
origem está em [Logging](../logging.md#origem-do-código-copiado). O
`bootstrap.ts` guarda estado no módulo e fica fora da métrica de cobertura,
com teste próprio.

## Revisar se

- a função passar a ter várias operações e a montagem manual das dependências
  ficar maior que a configuração de um framework de injeção; ou
- as cópias do código de logging divergirem a ponto de custar mais que um pacote
  compartilhado.

## Referências

- [Arquitetura](../architecture.md)
- [Customer-auth › ADR 0002](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0002-camadas-enxutas-com-composicao-memoizada.md)
- [Customer-auth › ADR 0004](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0004-empacotamento-e-publicacao.md)
