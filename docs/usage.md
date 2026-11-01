# Uso do SDK

## Configurar o cliente

```js
const raims = new Raims(apiKey, {
  timeout: 80000,
  maxNetworkRetries: 0,
});
```

`timeout` é o prazo por tentativa HTTP, incluindo a leitura do corpo, em
milissegundos, de 1 a 300000. O padrão é 80000. `maxNetworkRetries` vai de
0 a 5, com padrão 0, e só se aplica a leituras GET. A aplicação pode reutilizar
uma instância entre requisições para aproveitar as conexões do transporte.

Cada chamada aceita as opções `apiKey`, `idempotencyKey`, `timeout`,
`maxNetworkRetries` e `signal` por último. A credencial por requisição não
altera a configuração do cliente nem a de outra chamada.

```js
const charge = await raims.charges.retrieve(chargeId, {
  timeout: 15000,
  signal: abortController.signal,
});

const charges = await raims.charges.list({ customer_id: customerId }, {
  timeout: 15000,
});
```

O SDK aceita somente as opções documentadas. Não há headers arbitrários ou
configuração de ambiente. `apiBase` aceita uma origem HTTPS sem caminho,
credenciais, query ou fragmento. HTTP é permitido somente em loopback para
desenvolvimento local. Não desabilite a verificação TLS.

O transporte não segue redirects, não envia arquivos e não baixa as URLs
retornadas pela API. Faça uploads e downloads separadamente, sem anexar a
chave de API, respeitando método, tipo de conteúdo e expiração do link.

## Parâmetros e respostas

Os campos mantêm os nomes JSON da API. `undefined` em propriedades é omitido;
`null`, `false`, zero e objetos vazios são preservados. Isso permite distinguir
um campo ausente de um pedido explícito de limpeza em atualizações parciais.
Datas usam Unix segundos UTC; os timeouts do SDK usam milissegundos.

Use apenas dados JSON nos parâmetros. O SDK recusa proxies e operações que
executariam getters ou serializadores personalizados, inclusive nos itens
dos arrays. Uma propriedade `toJSON` que contenha dados comuns, como string ou `null`,
continua sendo um dado JSON.

Centavos e outros inteiros precisam caber em `Number.MAX_SAFE_INTEGER`.
Entradas fora dessa faixa são recusadas. O SDK verifica os tokens numéricos
recebidos antes de decodificar JSON e recusa respostas que arredondariam
inteiros ou frações para inteiros. Não converta identificadores string em
números nem valores financeiros em ponto flutuante.

As respostas passam por validação estrutural de campos obrigatórios, objetos,
listas, escalares, nulabilidade e valores fixos do contrato. Campos e valores
futuros de enums são preservados. Formatos, permissões, limites e regras de
negócio pertencem à API.

`lastResponse` contém `statusCode`, `requestId`, `idempotencyReplayed` e
`retryAfter`. Essa propriedade não entra em `JSON.stringify(resource)`.
Respostas documentadas sem corpo retornam `null`. Um status de sucesso não
documentado ou um corpo incompatível gera `UnexpectedResponseError`.

## Paginação

```js
const page = await raims.charges.list({ customer_id: customerId, page_size: 50 });
const next = await page.nextPage();
const previous = await page.previousPage();
```

Os métodos retornam `null` quando não há continuação nessa direção. Eles
preservam filtros, credencial e opções, removendo o cursor da direção contrária.
Não envie `after` e `before` juntos.

```js
await raims.charges.list({ page_size: 100 }).autoPagingEach(async charge => {
  await processCharge(charge);
  if (shouldStop()) return false;
});
```

`for await` e `autoPagingEach` avançam por todas as páginas, inclusive após uma
página vazia que indique continuação. Cursores ausentes ou repetidos geram
`UnexpectedResponseError`. Cada nova página pode falhar ou atingir rate limits.
Alterações concorrentes seguem as garantias da API; o iterador não cria um
snapshot dos dados. `autoPagingToArray({ limit })` exige um limite de 1 a
1000000 para controlar o uso de memória. A lista de tipos de evento de webhook
não é paginada.

## Erros e tentativas

```js
import { RateLimitError, ConnectionError } from 'raims';

try {
  await raims.customers.retrieve(customerId);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(error.statusCode, error.code, error.requestId);
  } else if (error instanceof ConnectionError) {
    // Avaliar a recuperação conforme o tipo de operação.
  } else {
    throw error;
  }
}
```

As categorias HTTP são `InvalidRequestError`, `AuthenticationError`,
`PermissionError`, `NotFoundError`, `ConflictError`, `RateLimitError` e
`ApiError`. Falhas de rede, cancelamento e timeout geram `ConnectionError`.
Falhas de protocolo geram `UnexpectedResponseError`. Todas derivam de
`RaimsError`; erros de configuração e serialização usam `TypeError`.
Cancelamentos mantêm a categoria `ConnectionError` também quando `abort(reason)`
recebe um motivo personalizado.

Os erros HTTP expõem `statusCode`, `code`, `requestId` e `lastResponse`.
`apiError` permite consultar explicitamente a mensagem e os detalhes da API;
esse conteúdo pode conter dados sensíveis e não é incluído na inspeção ou
serialização padrão do erro. Não registre corpos, credenciais, documentos
pessoais ou links temporários.

Se a leitura de uma resposta HTTP 4xx ou 5xx for concluída como texto UTF-8,
o SDK mantém a categoria HTTP mesmo quando o conteúdo não é um envelope de
erro válido. Nesse caso, `apiError` é `null`. Confira essa propriedade antes
de consultar a mensagem ou os detalhes da API.

Um corpo com UTF-8 inválido gera `UnexpectedResponseError`, inclusive em
respostas HTTP 4xx ou 5xx. O status e o identificador de requisição disponível
permanecem em `statusCode` e `requestId`. Essa falha de protocolo não é
repetida automaticamente.

Com retries habilitados, somente GET repete falhas de conexão e HTTP 408,
429, 500, 502, 503 ou 504. Há espera progressiva com variação aleatória.
`Retry-After` numérico ou em data HTTP é respeitado, inclusive quando a conexão
é interrompida após o recebimento dos headers. Se exigir mais de 30 segundos,
o erro é devolvido para a aplicação decidir quando tentar novamente.
Cancelamento e respostas inválidas não são repetidos.

POST, PATCH, PUT e DELETE nunca são repetidos automaticamente, mesmo com uma
chave de idempotência. Gere e persista uma chave para cada intenção quando
o endpoint aceitar o header. Ao repetir manualmente após perder a resposta,
reutilize a mesma chave e parâmetros. HTTP `202` mantém o resultado pendente.

## Diagnósticos e transporte

`requestObserver` recebe `operationId`, `method`, `path` parametrizado,
`attempt`, `durationMs`, `statusCode`, `requestId`, `willRetry` e `retryDelayMs`
após cada tentativa. Não recebe query, IDs de recurso, corpos ou credenciais.
Exceções ou rejeições do callback não mudam o resultado da chamada. Chamadas
iniciadas no contexto do callback não geram notificações recursivas.

Para adaptar o transporte, `fetch` deve seguir a Fetch API do Node.js, retornar
uma instância nativa de `Response`, respeitar `AbortSignal`, TLS e
`redirect: 'manual'`. Falhas de transporte usam `TypeError`, `AbortError`,
`TimeoutError` ou `ConnectionError`; outros erros da aplicação são propagados.
Um transporte customizado também precisa preservar o isolamento de headers.
O SDK não envia telemetria para terceiros.
