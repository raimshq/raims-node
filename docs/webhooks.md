# Receive webhooks

Read the original body as bytes before using a JSON parser. The helper
authenticates the delivery before decoding the JSON object.

```js
import { Webhook } from '@raimshq/raims';

const event = Webhook.constructEvent(rawBody, request.headers, webhookSecret);
```

`rawBody` accepts a string, `Buffer`, or `Uint8Array`. `request.headers` accepts
`Headers` or an object mapping header names to string values. The helpers are
also available at `Raims.Webhook` and `raims.webhooks`, without HTTP requests.
Use `verifySignature` when you only need to authenticate the bytes.

The secret is the `whsec_...` value returned when creating a webhook or rotating
its secret. It differs from the API key. Store it on the server and keep it out of logs.

The SDK checks `webhook-id`, `webhook-timestamp`, and `webhook-signature`, treating
header names as case-insensitive. The delivery ID must be a UUID. The Base62
secret is decoded to the 32 signing-key bytes in the order used by Raims.
HMAC-SHA256 authenticates `webhook-id.webhook-timestamp.original_body`, with a
constant-time comparison. One valid `v1` signature among the candidates
authenticates the delivery during secret rotation.

Duplicate or ambiguous headers are rejected. A `Headers` collection may combine
values before the SDK receives them: preserve header multiplicity in your HTTP
server and reject duplicates at the boundary. Multiple signature candidates in
one header are allowed for rotation.

The default tolerance is 300 seconds into the past or future. To change it:

```js
const event = Webhook.constructEvent(rawBody, request.headers, webhookSecret, {
  tolerance: 300,
});
```

`now` sets the reference time in UTC Unix seconds. `tolerance: 0` requires the
same second; it does not disable the time check. An invalid signature, a timestamp
outside the tolerance, or an incompatible authenticated JSON body raises
`SignatureVerificationError`.

After authenticating a delivery, check the environment and authorized data before
processing the event. Persist the work and deduplication before returning a
successful HTTP response. If persistence fails, return a failure to allow redelivery.
Use `event.id` to deduplicate processing: it identifies the logical event, while
`webhook-id` identifies the delivery. A signature does not eliminate redeliveries
or replace idempotent processing in your application.

## Payment instruction events

For new subscriptions, use `charge.payment_instructions_available` and
`charge.payment_instructions_failed`. Read `data.id` for the charge ID and
`data.payment_method` for the payment method. These event codes replace
`pix.available`, `pix.issuance_failed`, `boleto.available`, and
`boleto.issuance_failed` in the subscription catalog. Historical deliveries
can retain the earlier codes.

Read the event catalog for the authenticated environment before updating a
subscription. For refund and dispute events, use `data.charge_id` when the
event includes it.

Use the event and delivery history services to inspect saved events, deliveries,
and attempts. A response that accepts a resend or an earlier attempt does not
confirm that the destination received it.
