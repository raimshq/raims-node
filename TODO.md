# TODO

- [x] Concluir a validação canônica local pelo Developer Toolkit, com ferramentas
  fixadas, suítes reconstruídas em `.tmp`, tipos ESM/CommonJS, auditoria runtime
  e instalação limpa do pacote. Integrar o perfil do preflight sem alterar os
  demais SDKs.
- [x] Conferir a base independente de símbolos públicos e os bloqueios do gerador
  para combinações de contrato ainda sem suporte, com regressões de compatibilidade
  e de recusa em cópias isoladas.
- [x] Preparar a distribuição somente no GitHub em `raimshq/raims-node`, com
  metadados oficiais, perfil `public-sdk-source`, SAST JavaScript, pacote
  instalável e instruções de instalação pela release. Conferir tag, commit,
  hashes e instalação do asset no encerramento da publicação.
- [ ] Preparar a distribuição npm: confirmar o nome `raims` e sua titularidade,
  vincular o SAST e o CI nos runners autorizados à revisão imutável do Toolkit,
  validar o mesmo commit e conferir a instalação do registry após a publicação
  autorizada. A release no GitHub não confirma disponibilidade no npm.
- [ ] Incluir o SDK Node.js no contexto e nas fontes do atendimento na primeira
  distribuição. Criar os guias BR/EN responsáveis no `raims-developer-docs`
  com finalidade, quando sugerir a biblioteca, instalação, backend, chave,
  permissões, ambiente, simulações, disponibilidade, limites, paginação,
  idempotência, respostas pendentes, erros e webhooks. Conferir o mapa em
  `Raims-Chat/docs/knowledge-sources.md`, regenerar o catálogo existente e
  validar a orientação do bot nos dois idiomas. O SDK não cria novos estados
  de atendimento ou consultas financeiras: o contrato de contexto e as
  ferramentas atuais não precisam mudar. Concluir somente após confirmar
  pacote, fontes publicadas, catálogos e orientação.
- [ ] Publicar a nota de changelog do SDK Node.js em
  `raims-developer-docs/content/docs/changelog/post` com a data real da
  disponibilização e links para os guias e a versão confirmada. Incluir a
  proteção contra rejeições sem tratamento nos helpers de paginação, a
  validação de valores fixos das respostas e o tratamento de envelopes de
  erro inválidos, o respeito a `Retry-After` em respostas interrompidas e a
  consistência dos tipos e namespaces dos exports nomeados em ESM e CommonJS.
  Incluir também a normalização de cancelamentos com motivo personalizado.
  Incluir a correção que permite gravar e remover a chave `toJSON` em
  `metadata` quando seu valor é uma string ou `null`.
  Incluir a proteção que recusa getters e serializadores personalizados em
  arrays antes de preparar o corpo da requisição, preservando os dados enviados.
  A nota no site permanece pendente até sua publicação autorizada; a
  disponibilidade no GitHub é identificada pela release do repositório.
