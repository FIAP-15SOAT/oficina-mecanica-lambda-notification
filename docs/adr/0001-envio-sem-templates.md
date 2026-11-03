# ADR 0001: Envio sem templates, do e-mail montado por quem pede

## Status

Aceito — 2026-11-02

## Contexto

Dois serviços da solução mandam e-mail:

- o **Identity**, que cuida de usuários e acessos: senha inicial de um
  funcionário, código de redefinição de senha;
- o **Work Order**, que cuida das ordens de serviço: orçamento disponível para
  aprovação, mudanças na OS.

Cada e-mail tem assunto, texto, HTML e idioma, e o conteúdo depende de dados que
só o serviço dono tem — o nome do funcionário, os itens e o total do orçamento.

Os serviços não enviam e-mail diretamente: publicam um pedido
`notification.email.send` no tópico de eventos, e esta função faz o envio. A
decisão é **quem escreve o e-mail**: o serviço que pede ou esta função.

## Decisão

**O serviço que pede o e-mail o escreve inteiro.** O pedido traz `to`,
`subject`, `text` e `html` prontos, e a função os envia sem alterar nada, com o
remetente configurado nela (`MAIL_FROM`).

A função não tem modelos de e-mail (templates), não escolhe idioma e não conhece
os dados de negócio. Ela confere o pedido — destinatários válidos, conteúdo
preenchido, tudo em texto — e entrega.

O pedido pode trazer um `purpose`, um rótulo do tipo de e-mail
(`staff_initial_password`, `quote_sent`), usado só no log. Quem define os
valores é o serviço; a função não tem lista deles.

## Alternativas consideradas

**Templates na função.** O serviço mandaria o nome do template e os dados (por
exemplo `{ "template": "quote_sent", "data": { "total": ..., "itens": [...] } }`),
e a função montaria o e-mail.

- A favor: o HTML de todos os e-mails num lugar só, com visual único; pedidos
  menores.
- Contra: a função teria de conhecer o formato dos dados de cada serviço. Toda
  mudança num e-mail viraria uma mudança coordenada em dois repositórios: a
  função publica o template novo, e só depois o serviço pode mandar o dado novo.
- Contra: dados de negócio (nomes, valores, itens) passariam a ser interpretados
  fora do serviço dono, com a validação deles repetida aqui.
- Contra: a função deixaria de só entregar e passaria a ter regra de
  apresentação, com testes para cada template.

Rejeitada.

**Lista fixa de valores de `purpose` na função.** Se a função recusasse um valor
desconhecido, todo e-mail novo exigiria publicar a função antes do serviço; se
aceitasse, o e-mail novo apareceria no log como `unspecified` até a função ser
atualizada. Rejeitada: o propósito é texto num formato fixo, sem lista.

## Consequências

**Positivas.** Um e-mail novo, ou uma mudança de texto, muda só o serviço que o
envia. A função fica pequena, sem dado de negócio, e os testes dela não dependem
de nenhum e-mail específico.

**Negativas.** Cada serviço mantém os próprios e-mails; um visual comum depende
de os serviços seguirem o mesmo padrão. O pedido carrega o HTML inteiro — sem
impacto para e-mails curtos como os da oficina.

**Efeito na segurança.** Como a função não entende o conteúdo, ela não consegue
reconhecer uma senha ou um código no meio dele. Por isso assunto, texto, HTML e
endereços nunca vão para o log — ver
[Logging](../logging.md#o-que-nunca-é-registrado).

## Revisar se

- os serviços passarem a repetir o mesmo layout e as diferenças entre eles
  virarem um problema real; ou
- o propósito passar a mudar o comportamento da entrega (remetente, canal ou
  prioridade).

## Referências

- [Contrato](../contracts.md)
- [Segurança › Conteúdo fora do log](../security.md#conteúdo-fora-do-log)
