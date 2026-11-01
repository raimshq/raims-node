# Receber webhooks

Leia o corpo original como bytes, antes de qualquer parser JSON. O helper
autentica a entrega e só então decodifica o objeto JSON.

```js
import { Webhook } from 'raims';

const event = Webhook.constructEvent(rawBody, request.headers, webhookSecret);
```

`rawBody` aceita string, `Buffer` ou `Uint8Array`. `request.headers` aceita
`Headers` ou um objeto com nomes de headers e valores string. Os helpers
também estão em `Raims.Webhook` e em `raims.webhooks`, sem fazer chamadas HTTP.
Use `verifySignature` quando precisar apenas autenticar os bytes.

O segredo é o valor `whsec_...` retornado no cadastro ou na rotação do webhook.
Ele é diferente da chave de API. Guarde-o no servidor e mantenha-o fora dos logs.

O SDK confere `webhook-id`, `webhook-timestamp` e `webhook-signature`, sem
distinguir maiúsculas de minúsculas nos nomes dos headers. O ID da entrega
precisa ser um UUID. O segredo Base62 é decodificado para os 32 bytes da chave
de assinatura na ordem usada pela Raims. A assinatura HMAC-SHA256 autentica
`webhook-id.webhook-timestamp.corpo_original`; a comparação usa tempo constante.
Uma assinatura `v1` válida entre as candidatas autentica a entrega durante a
rotação de segredos.

Headers duplicados ou ambíguos são recusados. Coleções `Headers` podem juntar
valores antes de o SDK recebê-los: preserve a multiplicidade dos headers no
servidor HTTP e recuse duplicatas na entrada. Candidatas de assinatura no mesmo
header são permitidas para rotação.

A tolerância padrão é de 300 segundos para o passado e o futuro. Para ajustá-la:

```js
const event = Webhook.constructEvent(rawBody, request.headers, webhookSecret, {
  tolerance: 300,
});
```

`now` permite informar o instante de referência em segundos Unix UTC.
`tolerance: 0` exige o mesmo segundo e não desabilita a conferência de tempo.
Assinatura inválida, tempo fora da tolerância ou JSON autenticado incompatível
geram `SignatureVerificationError`.

Depois de autenticar a entrega, confira o ambiente e os dados autorizados antes
de processar o evento. Persista o trabalho e a deduplicação antes de responder
com sucesso HTTP; se não conseguir persistir, retorne falha para permitir a
reentrega. Use `event.id` para deduplicar o processamento: ele identifica
o evento lógico; `webhook-id` identifica a entrega. A assinatura não elimina
reentregas nem substitui a idempotência do processamento da sua aplicação.
