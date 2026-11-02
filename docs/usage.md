# SDK usage

## Configure the client

```js
const raims = new Raims(apiKey, {
  timeout: 80000,
  maxNetworkRetries: 0,
});
```

`timeout` is the deadline for each HTTP attempt, including reading the body,
in milliseconds from 1 to 300000. The default is 80000. `maxNetworkRetries`
ranges from 0 to 5, defaults to 0, and only applies to GET reads. Your application
can reuse one client across requests to reuse transport connections.

Every method accepts `apiKey`, `idempotencyKey`, `timeout`, `maxNetworkRetries`,
and `signal` in its final options argument. A per-request credential does not
change the client configuration or another request's credential.

```js
const charge = await raims.charges.retrieve(chargeId, {
  timeout: 15000,
  signal: abortController.signal,
});

const charges = await raims.charges.list({ customer_id: customerId }, {
  timeout: 15000,
});
```

The SDK accepts only documented options. Arbitrary headers and environment
configuration are not supported. `apiBase` accepts an HTTPS origin without a
path, credentials, query, or fragment. HTTP is allowed only on loopback for
local development. Do not disable TLS verification.

The transport does not follow redirects, upload files, or download URLs returned
by the API. Upload and download separately without attaching the API key,
respecting the link's method, content type, and expiration.

## Parameters and responses

Fields retain the API's JSON names. Object properties set to `undefined` are
omitted; `null`, `false`, zero, and empty objects are preserved. This distinguishes
an absent field from an explicit request to clear a field in a partial update.
Dates use UTC Unix seconds; SDK timeouts use milliseconds.

Use only JSON data in parameters. The SDK rejects proxies and operations that
would execute getters or custom serializers, including array items. A `toJSON`
property containing ordinary data, such as a string or `null`, remains JSON data.

Cent amounts and other integers must fit within `Number.MAX_SAFE_INTEGER`.
Inputs outside that range are rejected. The SDK checks received numeric tokens
before decoding JSON and rejects responses that would round integers or
fractions to integers. Do not turn string identifiers into numbers or use
floating-point numbers for financial amounts.

Responses undergo structural validation of required fields, objects, lists,
scalars, nullability, and fixed contract values. Future fields and enum values
are preserved. Formats, permissions, limits, and business rules belong to the API.

`lastResponse` contains `statusCode`, `requestId`, `idempotencyReplayed`, and
`retryAfter`. It is excluded from `JSON.stringify(resource)`. Documented empty
responses return `null`. An undocumented success status or incompatible body
raises `UnexpectedResponseError`.

## Pagination

```js
const page = await raims.charges.list({ customer_id: customerId, page_size: 50 });
const next = await page.nextPage();
const previous = await page.previousPage();
```

These methods return `null` when there is no continuation in that direction.
They retain filters, credentials, and options, and remove the opposite cursor.
Do not send `after` and `before` together.

```js
await raims.charges.list({ page_size: 100 }).autoPagingEach(async charge => {
  await processCharge(charge);
  if (shouldStop()) return false;
});
```

`for await` and `autoPagingEach` advance through every page, including an empty
page that indicates continuation. Missing or repeated cursors raise
`UnexpectedResponseError`. Each subsequent page can fail or reach a rate limit.
Concurrent changes follow the API's guarantees; the iterator does not create
a data snapshot. `autoPagingToArray({ limit })` requires a limit from 1 to
1000000 to bound memory use. The webhook event-type list is not paginated.

## Errors and retries

```js
import { RateLimitError, ConnectionError } from '@raimshq/raims';

try {
  await raims.customers.retrieve(customerId);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(error.statusCode, error.code, error.requestId);
  } else if (error instanceof ConnectionError) {
    // Decide how to recover based on the operation.
  } else {
    throw error;
  }
}
```

HTTP error categories are `InvalidRequestError`, `AuthenticationError`,
`PermissionError`, `NotFoundError`, `ConflictError`, `RateLimitError`, and
`ApiError`. Network failures, cancellation, and timeouts raise `ConnectionError`.
Protocol failures raise `UnexpectedResponseError`. All extend `RaimsError`;
configuration and serialization errors use `TypeError`. Cancellation remains a
`ConnectionError` when `abort(reason)` receives a custom reason.

HTTP errors expose `statusCode`, `code`, `requestId`, and `lastResponse`.
`apiError` provides explicit access to the API's message and details. This
content may contain sensitive data and is excluded from default error inspection
and serialization. Do not log bodies, credentials, personal documents, or temporary links.

When an HTTP 4xx or 5xx response body is fully read as UTF-8 text, the SDK retains
the HTTP error category even if the content is not a valid error envelope.
In that case, `apiError` is `null`. Check this property before reading the
API's message or details.

An invalid UTF-8 body raises `UnexpectedResponseError`, including for HTTP 4xx
or 5xx responses. The available status and request identifier remain accessible
through `statusCode` and `requestId`. This protocol failure is not retried automatically.

With retries enabled, only GET retries connection failures and HTTP 408, 429,
500, 502, 503, or 504. Backoff increases between attempts and includes jitter.
Numeric or HTTP-date `Retry-After` values are respected, including when the
connection fails after receiving headers. If the required wait exceeds 30
seconds, the error is returned so your application can decide when to retry.
Cancellation and invalid responses are not retried.

POST, PATCH, PUT, and DELETE are never retried automatically, even with an
idempotency key. Generate and persist one key for each intent when the endpoint
accepts the header. When retrying manually after losing a response, reuse the
same key and parameters. HTTP `202` keeps the result pending.

## Diagnostics and transport

`requestObserver` receives `operationId`, `method`, the parameterized `path`,
`attempt`, `durationMs`, `statusCode`, `requestId`, `willRetry`, and `retryDelayMs`
after each attempt. It does not receive queries, resource IDs, bodies, or
credentials. Callback exceptions or rejections do not change the request's
result. Requests started in the callback's context do not emit recursive notifications.

A custom `fetch` must follow the Node.js Fetch API, return a native `Response`,
and respect `AbortSignal`, TLS, and `redirect: 'manual'`. Transport failures use
`TypeError`, `AbortError`, `TimeoutError`, or `ConnectionError`; other application
errors are propagated. Custom transports must also retain header isolation.
The SDK does not send telemetry to third parties.
