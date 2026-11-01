# Raims Node.js SDK

Leia README, CONTRIBUTING e docs/maintenance.md antes de alterar este SDK.

- Consuma somente o contrato público fixado em contracts, com hash e revisão
  imutável conferidos. Não importe código ou contratos privados dos hosts.
- O pacote usa Node.js 22 ou superior, módulos ESM e CommonJS e declarações
  TypeScript. Não exige dependências de produção.
- src/generated/contract.json, types/index.d.cts, types/index.d.mts e
  docs/reference.md são gerados por scripts/generate.cjs. Não os edite à mão.
- Preserve nomes JSON, centavos inteiros seguros, Unix segundos, ausência e null.
  O SDK não gera idempotência nem repete escritas automaticamente.
- A autenticação usa chave de API. Não ofereça seleção de ambiente nem headers
  arbitrários. Credenciais pertencem ao backend do integrador.
- Preserve a validação estrutural de respostas e os campos futuros. Inteiros
  fora do intervalo seguro de JavaScript são recusados sem arredondamento.
- O transporte não segue redirects, não baixa links externos e não faz uploads.
  Diagnósticos contêm somente método, caminho parametrizado, tentativa, duração,
  status e identificador de requisição.
- Testes, simuladores, consumidores de validação, ferramentas e evidências ficam
  exclusivamente em C:\server\raims\.tmp\raims-node-sdk. Não os versione.
- `contracts/node-api.json` é a base independente dos símbolos públicos.
  `npm run check-compatibility` apenas confere. Sua atualização deliberada usa
  `npm run snapshot-api` e exige revisar o diff; gerar o OpenAPI não a regrava.
- Execute `npm run check`, que chama o validador canônico do Developer Toolkit.
  O primeiro preparo das ferramentas usa `npm run check -- --prepare-tools`.
  `npm run check-source` cobre somente gerados e sintaxe, sem aprovação completa.
  Valide HTTP somente com dependências isoladas; não chame a API real.
- O pacote npm contém runtime, tipos e guias do integrador. Contratos,
  geradores, base de compatibilidade e instruções internas ficam fora dele.
- Deixe alterações sem commit e sem conteúdo em staging. Publicação no npm,
  criação de repositório remoto, push, release e deploy exigem autorização própria.
- Descreva os recursos da Raims diretamente. Preserve licenças e atribuições
  obrigatórias de qualquer código incorporado.
