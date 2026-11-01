# Contribuir

Leia `AGENTS.md` e o [guia de manutenção](docs/maintenance.md). Preserve nomes
JSON, centavos inteiros, segundos Unix, omissão, null e o significado de `202`.
Serviços e tipos derivados do contrato devem ser gerados, sem edição manual.

Execute o gate completo a partir do checkout:

```sh
npm run check -- --prepare-tools
npm run check
```

`--prepare-tools` autoriza o primeiro preparo das ferramentas fixadas no cache
da `.tmp`. Sem essa opção, ferramenta ausente ou integridade divergente
interrompe a validação. Nada é instalado globalmente. `RAIMS_PYTHON` permite
selecionar o Python usado pelo atalho.

O comando chama o validador canônico do Developer Toolkit. Ele confere contrato,
geração, sintaxe, compatibilidade, tipos ESM/CommonJS, regressões e instalação
limpa do pacote, além de auditar as dependências runtime. Os arquivos físicos
de teste e seus resultados são reconstruídos somente em `.tmp`; a execução
não depende de suítes antigas da estação nem chama a API financeira real.

Um clone sem o Toolkit não pode aprovar o gate completo. Nesse caso,
`npm run check-source` permite conferir apenas os gerados e a sintaxe.

## Compatibilidade pública

`npm run check-compatibility` compara os símbolos com `contracts/node-api.json`
sem alterar a base. Ela é independente do OpenAPI: renomear um método do SDK
continua podendo quebrar uma integração mesmo quando a rota HTTP é a mesma.
Mudanças de tipos, obrigatoriedade e assinaturas precisam ser revisadas.

Uma atualização deliberada usa `npm run snapshot-api`, com as ferramentas
preparadas, seguida da revisão do diff. Não atualize a base para esconder
uma quebra nem a regrave como parte de `npm run generate`. O check aceita
adições claramente compatíveis e é conservador em mudanças complexas.

## Cobertura da validação

Mudanças no gerador ou runtime precisam de cenários independentes para:

- Todas as operações e seus status de sucesso, com método, caminho, query e JSON.
- POST sem corpo, JSON em DELETE, `202`, respostas vazias e erros sem envelope.
- Null, omissão, false, zero, mapas vazios e campos futuros.
- Inteiros seguros, overflow e frações que seriam arredondadas para inteiros.
- Opções por chamada, chamadas concorrentes e isolamento entre clientes.
- Retry somente de leitura, `Retry-After`, timeout e cancelamento.
- Paginação nos dois sentidos, filtros, páginas vazias, cursores ausentes e ciclos.
- Redirect bloqueado e HTTP local usando o transporte nativo.
- Webhook com bytes originais, Base62, rotação, relógio e headers ambíguos.
- Diagnósticos sanitizados e callbacks que falham ou iniciam outras chamadas.

Use transporte falso e receptores em loopback. Não chame a API real durante
a validação: até o Sandbox pode gerar comunicações externas. Testes, simuladores,
dependências de validação e relatórios ficam exclusivamente em
`C:\server\raims\.tmp\raims-node-sdk`, fora deste repositório. Encerre os
processos e confirme a liberação das portas antes de concluir.

Descreva os recursos da Raims diretamente nos textos. Preserve licenças e
atribuições obrigatórias de qualquer código incorporado. Não inclua dados
pessoais, chaves, segredos ou links temporários em exemplos e evidências.

Revise todos os arquivos alterados e novos, `git diff` e `git diff --cached`.
Mantenha as alterações sem commit e sem staging até um pedido explícito.
Publicação npm, repositório remoto, push e release são etapas independentes.
