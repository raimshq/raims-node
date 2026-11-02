# Raims Node.js

Official Node.js SDK for the Raims public API, with TypeScript types,
ESM and CommonJS modules, and methods organized by resource.

Requires Node.js 22 or later. Uses Node.js HTTP transport and has no production
dependencies. Run the SDK on the server and keep API keys out of browsers,
version control, and logs.

## Install

In the application that will use the SDK:

```sh
npm install raims
```

The package name is `raims`. TypeScript declarations are included. Keep your
application's lockfile to reproduce the installed dependency versions.

To update to the latest stable version:

```sh
npm install raims@latest
```

Read the [release notes](https://github.com/raimshq/raims-node/releases) and test
your integration after updating. Future updates are not installed automatically.

The [GitHub releases](https://github.com/raimshq/raims-node/releases/latest)
also provide `raims-node.tgz` and `SHA256SUMS`. To install a downloaded package,
verify its checksum and run `npm install /path/to/raims-node.tgz`.

## Quick start

```js
import Raims from 'raims';

const apiKey = process.env.RAIMS_API_KEY;
if (!apiKey) throw new Error('Set RAIMS_API_KEY on the server.');

const raims = new Raims(apiKey);
const customers = await raims.customers.list({ page_size: 20 });

for (const customer of customers.list) {
  console.log(customer.id);
}
```

For CommonJS, use `const Raims = require('raims')`. The named exports `Raims`
and `RaimsClient` refer to the same constructor.

The base URL is `https://api.raims.com` in both environments. The API key
determines the company, environment, and permissions; the client does not
provide an environment selector. Use a Sandbox key for simulations.

## Create a charge

This example uses an existing customer. `customerId`, `chargeDueDate`, and
`chargeIdempotencyKey` are values your application defines and persists for
the order before sending the request.

```js
const charge = await raims.charges.create({
  customer_id: customerId,
  amount_cents: 15000,
  due_date: chargeDueDate,
  title: 'Order 1234',
}, {
  idempotencyKey: chargeIdempotencyKey,
});

const { statusCode, requestId } = charge.lastResponse;
```

`15000` means BRL 150.00. Resource dates use UTC Unix seconds. After losing a
response, retain the same key and every parameter, including the due date.
The SDK does not generate idempotency keys or retry writes automatically.
HTTP `202` means the result is pending and you must track the resource; it
does not confirm payment or completion of the financial operation.

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

Types are also available in the `Raims` namespace, such as
`Raims.CreateChargeParams` and `Raims.Charge`. They are generated from the
same contract that defines the methods and structural response validation.

## Iterate through pages

```js
for await (const charge of raims.charges.list({ page_size: 100 })) {
  await processCharge(charge);
}

const customers = await raims.customers.list().autoPagingToArray({ limit: 200 });
```

The iterator fetches pages as needed and stops when you leave the loop.
`await list()` returns a page with `list`, `page`, `nextPage()`, and
`previousPage()`. Filters and options are retained for subsequent reads.

## Resources

`accounts`, `balances`, `customers`, `charges`, `paymentLinks`, `refunds`,
`disputes`, `statements`, `withdrawals`, `withdrawalDestinations`, `webhooks`,
`webhookEventTypes`, `simulations.charges`, and `simulations.refunds`.

See the [reference](docs/reference.md) for each resource's methods.

## Documentation

- [Configuration, pagination, errors, and idempotency](docs/usage.md)
- [Receiving and authenticating webhooks](docs/webhooks.md)
- [Method reference](docs/reference.md)
- [Security](SECURITY.md)
- [API documentation](https://docs.raims.com/en/api)
- [Installation and integration guide](https://docs.raims.com/en/integracoes/sdk-node)

Distributed under the [MIT license](LICENSE).
