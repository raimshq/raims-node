# Contrato e manutenção

## Fonte e geração

`contracts/source.json` registra a revisão pública imutável, o SHA-256, a
versão HTTP, a revisão implantada e a quantidade de operações.
`contracts/openapi.json` preserva os bytes dessa revisão de
[raimshq/openapi](https://github.com/raimshq/openapi). A fonte canônica pertence
à Public API; o SDK consome somente a superfície com publicação comprovada.

```sh
npm run generate
npm run check-generated
npm run check-source
npm run check-compatibility
npm run check
```

A geração é offline, confere o checksum e exige que `contracts/service-map.json`
cubra cada operação exatamente uma vez. Produz o catálogo de transporte, os
modelos e serviços TypeScript e a referência de métodos. `--check` compara as
saídas sem regravá-las. O SDK suporta chave de API; os parâmetros exclusivos
de OAuth do contrato não entram nas assinaturas nem no transporte.

O gerador recusa combinações que exigem suporte adicional: corpo e query na
mesma operação, serializações de query diferentes de form, parâmetros fora
das posições suportadas, identificadores de caminho não textuais, composições
`oneOf`/`allOf`, nulabilidade legada e múltiplos tipos não nulos. Referências
com alterações estruturais também exigem revisão. Não retire esses bloqueios
sem alinhar tipos, transporte, validação e regressões.

| Caminho | Responsabilidade |
| --- | --- |
| `src/index.cjs` e `src/index.mjs` | Composição e exports CommonJS/ESM |
| `src/requestor.cjs` | Configuração, transporte, retries de leitura e erros HTTP |
| `src/validation.cjs` | JSON, precisão numérica e estrutura das respostas |
| `src/pagination.cjs` | Cursores, navegação e iteradores |
| `src/webhook.cjs` | Autenticação do corpo original |
| `src/errors.cjs` | Categorias e diagnóstico de falhas |
| `scripts/generate.cjs` | Geração determinística a partir do contrato fixado |

Ao atualizar o contrato, confira manifesto e checksum públicos antes de trocar
o snapshot e a origem. Revise mudanças de tipos, status, campos obrigatórios,
nulabilidade, autenticação, ambiente, paginação e idempotência. Não edite o
snapshot para inventar endpoints ou regras. Atualize o mapa de serviços e
regenere as saídas; revise todo o diff e os impactos na aplicação consumidora.

## Verificação local

`npm run check` chama `Developer-Toolkit/scripts/release-preflight/node_sdk.py`.
O adapter reconstrói as suítes e consumidores a partir de suas receitas
versionadas e grava os arquivos físicos somente em `.tmp`. Confere as fontes
antes e depois da execução, o contrato fixado, a geração, a sintaxe, os tipos,
a compatibilidade e o pacote instalado, com transporte falso e loopback.

O primeiro preparo usa `npm run check -- --prepare-tools`. TypeScript e os tipos
do Node.js ficam em versões exatas no cache, com lockfile e integridades
conferidas. `RAIMS_PYTHON` seleciona o Python do atalho. Ferramenta ausente ou
divergente, auditoria incompleta e mudanças nas fontes bloqueiam a validação.

O relatório só aprova a execução após a conferência final de integridade.
Se essa conferência falhar, o resultado é de falha, mesmo quando os testes
anteriores passaram. Os comandos e seus descendentes são encerrados também
quando o processo principal termina normalmente. O gate de engenharia exige
contenção de processos disponível no Windows ou no Linux; isso não altera
os requisitos do runtime do SDK instalado pelo integrador.

`npm run check-source` é um check parcial de geração e sintaxe, disponível
sem o Toolkit. Um clone isolado não declara o gate completo aprovado. Todos
os testes, simuladores, consumidores e relatórios permanecem em
`C:\server\raims\.tmp\raims-node-sdk`.

O lifecycle `prepack` chama o gate completo. Dentro desse gate, o pacote é
criado com `--ignore-scripts` para evitar recursão, instalado em um consumidor
limpo e conferido em ESM e CommonJS. O artefato contém somente runtime, tipos,
guias do integrador e licença. Contratos, gerador, base de compatibilidade,
instruções internas, ferramentas e testes ficam fora da distribuição.

## Compatibilidade da biblioteca

`contracts/node-api.json` registra os símbolos públicos TypeScript e os
exports de runtime. `npm run check-compatibility` compara a implementação
com essa base sem gravá-la. Ela é independente do contrato HTTP e não muda
durante `npm run generate`.

O check recusa remoções, renomes e mudanças incompatíveis de tipos,
obrigatoriedade e parâmetros, incluindo novos métodos obrigatórios em tipos
estruturais. Métodos opcionais podem ser adicionados sem exigir mudanças dos
consumidores existentes. Adições claramente compatíveis são permitidas;
mudanças complexas passam por comparação conservadora. TypeScript 6.0.3 é
usado para extrair as declarações. `RAIMS_TYPESCRIPT` ou `--typescript` permite
indicar o módulo dessa versão; o gate usa a cópia cuja integridade conferiu.

Uma revisão deliberada da base usa `npm run snapshot-api`. Confira o diff,
o significado das mudanças e os consumidores antes de aceitá-la. Atualizar
o manifesto não torna uma alteração incompatível segura.

## Distribuição e atendimento

O repositório público é `raimshq/raims-node`. A primeira entrega usa somente
o GitHub: fontes na `main`, tag da versão de `package.json` e release com
`raims-node.tgz` e `SHA256SUMS`. O pacote vem da rodada aprovada do gate;
confira o commit da tag, baixe o asset, compare o hash e valide a instalação
em um consumidor limpo. O nome interno do pacote é `raims`.

O perfil `public-sdk-source` exige os gates Commit e Deploy, incluindo SAST
JavaScript, auditoria runtime e checks do destino. Essa entrega não possui
workflows executáveis. O CI futuro deve usar os runners AWS autorizados e
uma revisão imutável do Toolkit que contenha o validador Node.js.

Uma publicação npm exige autorização própria, confirmação da titularidade
do nome, validação do mesmo commit no CI autorizado e instalação a partir
do registry. Não acrescente credenciais aos fontes ou logs nem crie
infraestrutura para contornar o fluxo de releases.

Na publicação dos guias BR/EN no `raims-developer-docs`, use a distribuição
efetivamente disponível e registre o changelog na data real. A publicação
desse site segue autorização própria. Essa fonte já alimenta o atendimento;
regenere os catálogos e valide as respostas do bot. A orientação deve cobrir backend,
permissões, ambiente pela chave, simulações, paginação, idempotência, `202`,
erros e webhooks. Não é necessário acrescentar dados de conta nem ferramentas
financeiras ao contrato de contexto do chat por causa da biblioteca.

O SDK não altera a Public API nem o comportamento HTTP consumido pelo CLI,
pelos SDKs PHP/.NET ou pelo MCP. Esses consumidores não exigem regeneração
para esta entrega. Acompanhe disponibilidade, integração ao atendimento e
publicação em `TODO.md` até confirmar os destinos autorizados.
