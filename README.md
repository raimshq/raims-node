# Raims Node.js

SDK para integrar aplicações Node.js à API pública da Raims, com tipos
TypeScript, módulos ESM e CommonJS e métodos organizados por recurso.

Requer Node.js 22 ou superior. Usa o transporte HTTP do Node.js e não exige
dependências de produção. Execute o SDK no servidor e mantenha a chave de API
fora do navegador, do controle de versão e dos logs.

## Instalação pelo GitHub

No projeto que vai consumir o SDK, instale o pacote da release atual:

```sh
npm install https://github.com/raimshq/raims-node/releases/latest/download/raims-node.tgz
```

O nome do pacote é `raims`. Os tipos são incluídos na instalação. A distribuição
no registry npm ainda não está disponível.

Para atualizar, baixe o pacote da
[release atual](https://github.com/raimshq/raims-node/releases/latest) e instale
o arquivo no projeto consumidor:

```sh
npm install /caminho/para/raims-node.tgz
```

Confira as notas da release e teste sua integração após atualizar. A instalação
registra a versão escolhida; atualizações futuras não são aplicadas automaticamente.

## Primeiro uso

```js
import Raims from 'raims';

const apiKey = process.env.RAIMS_API_KEY;
if (!apiKey) throw new Error('Configure RAIMS_API_KEY no servidor.');

const raims = new Raims(apiKey);
const customers = await raims.customers.list({ page_size: 20 });

for (const customer of customers.list) {
  console.log(customer.id);
}
```

Com CommonJS, use `const Raims = require('raims')`. Também estão disponíveis
os exports nomeados `Raims` e `RaimsClient`, que representam o mesmo construtor.

A URL-base é `https://api.raims.com` nos dois ambientes. A chave de API
determina a empresa, o ambiente e as permissões; o cliente não oferece um
seletor de ambiente. Use uma chave Sandbox para as simulações.

## Criar uma cobrança

O exemplo usa um cliente já cadastrado. `customerId`, `chargeDueDate` e
`chargeIdempotencyKey` são valores definidos e persistidos pela aplicação
para o pedido antes da requisição.

```js
const charge = await raims.charges.create({
  customer_id: customerId,
  amount_cents: 15000,
  due_date: chargeDueDate,
  title: 'Pedido 1234',
}, {
  idempotencyKey: chargeIdempotencyKey,
});

const { statusCode, requestId } = charge.lastResponse;
```

`15000` representa R$ 150,00. Datas dos recursos usam segundos Unix UTC.
Após perder uma resposta, conserve a mesma chave e todos os parâmetros,
inclusive o vencimento. O SDK não gera chaves de idempotência e não repete
escritas automaticamente. HTTP `202` indica resultado pendente e exige
acompanhar o recurso; não confirma pagamento ou conclusão financeira.

## TypeScript

```ts
import Raims, { type CreateChargeParams } from 'raims';

const params: CreateChargeParams = {
  customer_id: customerId,
  amount_cents: 15000,
  due_date: chargeDueDate,
};

const charge = await raims.charges.create(params, {
  idempotencyKey: chargeIdempotencyKey,
});
```

Os tipos também estão no namespace `Raims`, por exemplo
`Raims.CreateChargeParams` e `Raims.Charge`. São gerados do mesmo contrato
que define os métodos e a validação estrutural das respostas.

## Percorrer páginas

```js
for await (const charge of raims.charges.list({ page_size: 100 })) {
  await processCharge(charge);
}

const customers = await raims.customers.list().autoPagingToArray({ limit: 200 });
```

O iterador busca novas páginas quando necessário e para ao sair do laço.
`await list()` retorna uma página com `list`, `page`, `nextPage()` e
`previousPage()`. Filtros e opções acompanham as próximas leituras.

## Recursos

`accounts`, `balances`, `customers`, `charges`, `paymentLinks`, `refunds`,
`disputes`, `statements`, `withdrawals`, `withdrawalDestinations`, `webhooks`,
`webhookEventTypes`, `simulations.charges` e `simulations.refunds`.

Consulte a [referência](docs/reference.md) para os métodos de cada recurso.

## Documentação

- [Configuração, paginação, erros e idempotência](docs/usage.md)
- [Recebimento e autenticação de webhooks](docs/webhooks.md)
- [Referência dos métodos](docs/reference.md)
- [Segurança](SECURITY.md)
- [Documentação da API](https://docs.raims.com/br/api)

Distribuído sob a licença [MIT](LICENSE).
