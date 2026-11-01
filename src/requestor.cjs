'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { AsyncLocalStorage } = require('node:async_hooks');
const errors = require('./errors.cjs');
const { version } = require('../package.json');
const { assertOptions, boundedInteger, isObject, parseJson, serializeParams, validateResponse } = require('./validation.cjs');
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function validateKey(key) {
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(key)) {
    throw new TypeError('apiKey must be a non-empty bearer credential without whitespace.');
  }
  return key;
}

function validateBase(value) {
  if (typeof value !== 'string' || /[\s\\]/.test(value)) throw new TypeError('apiBase must be an HTTPS origin.');
  let url;
  try { url = new URL(value); } catch { throw new TypeError('apiBase must be an HTTPS origin.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !/^https?:\/\/[^/?#]+\/?$/.test(value) ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new TypeError('apiBase requires HTTPS without credentials, a path, query or fragment; HTTP is allowed only on loopback.');
  }
  return url.origin;
}

function optionsFor(value) {
  assertOptions(value, ['apiKey', 'idempotencyKey', 'timeout', 'maxNetworkRetries', 'signal'], 'Request options');
  const options = { ...value };
  if (options.apiKey !== undefined) validateKey(options.apiKey);
  if (options.idempotencyKey !== undefined && (typeof options.idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(options.idempotencyKey))) {
    throw new TypeError('idempotencyKey must contain 1 to 255 visible ASCII characters.');
  }
  if (options.timeout !== undefined) boundedInteger(options.timeout, 1, 300000, 'timeout');
  if (options.maxNetworkRetries !== undefined) boundedInteger(options.maxNetworkRetries, 0, 5, 'maxNetworkRetries');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal.');
  return Object.freeze(options);
}

function safeHeader(headers, name) {
  const value = headers.get(name);
  return value && /^[\x20-\x7e]{1,256}$/.test(value) ? value : null;
}

function responseInfo(response) {
  return Object.freeze({ statusCode: response.status,
    requestId: safeHeader(response.headers, 'request-id') ?? safeHeader(response.headers, 'x-request-id'),
    idempotencyReplayed: response.headers.get('idempotency-replayed')?.toLowerCase() === 'true',
    retryAfter: safeHeader(response.headers, 'retry-after') });
}

function retryDelay(attempt, retryAfter) {
  let wait = Math.max(250, Math.min(2000, 250 * 2 ** attempt) * (0.5 + Math.random() * 0.5));
  if (retryAfter) {
    const seconds = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : (Date.parse(retryAfter) - Date.now()) / 1000;
    if (seconds > 30) return null;
    if (Number.isFinite(seconds)) {
      wait = Math.max(wait, seconds * 1000);
    }
  }
  return Math.ceil(wait);
}

async function readBody(response, info) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new errors.UnexpectedResponseError('The API response exceeds the supported size.', info);
      chunks.push(Buffer.from(value));
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw new errors.UnexpectedResponseError('The API response contains invalid UTF-8.', info); }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

class Requestor {
  #apiKey; #base; #timeout; #retries; #fetch; #observer; #observerContext = new AsyncLocalStorage();
  constructor(apiKey, config = {}) {
    assertOptions(config, ['apiBase', 'timeout', 'maxNetworkRetries', 'fetch', 'requestObserver'], 'Client configuration');
    this.#apiKey = validateKey(apiKey);
    this.#base = validateBase(config.apiBase ?? 'https://api.raims.com');
    this.#timeout = boundedInteger(config.timeout ?? 80000, 1, 300000, 'timeout');
    this.#retries = boundedInteger(config.maxNetworkRetries ?? 0, 0, 5, 'maxNetworkRetries');
    this.#fetch = config.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function') throw new TypeError('fetch must be a Fetch API compatible function.');
    this.#observer = config.requestObserver;
    if (this.#observer !== undefined && typeof this.#observer !== 'function') throw new TypeError('requestObserver must be a function.');
  }

  prepare(operation, pathValues, params = {}, requestOptions = {}) {
    const options = optionsFor(requestOptions);
    if (options.idempotencyKey !== undefined && !operation.idempotency) throw new TypeError('This operation does not accept idempotencyKey.');
    if (!isObject(params)) throw new TypeError('params must be a JSON object.');
    const serialized = serializeParams(params);
    const snapshot = JSON.parse(serialized);
    if (snapshot.after != null && snapshot.before != null) throw new TypeError('after and before cannot be used together.');
    let path = operation.path;
    operation.pathParams.forEach((name, index) => {
      const value = pathValues[index];
      if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\x00-\x20\x7f]/.test(value)) {
        throw new TypeError('Path arguments must be non-empty identifiers without whitespace or control characters.');
      }
      path = path.replace(`{${name}}`, encodeURIComponent(value));
    });
    const headers = { Authorization: `Bearer ${options.apiKey ?? this.#apiKey}`, Accept: 'application/json', 'User-Agent': `RaimsNode/${version}` };
    if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;
    let body;
    if (operation.body) {
      body = serialized;
      if (operation.maxBodyBytes && Buffer.byteLength(body) > operation.maxBodyBytes) throw new TypeError('Request body exceeds the published size limit.');
      headers['Content-Type'] = 'application/json';
    } else {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(snapshot)) {
        if (!Object.hasOwn(operation.query, name)) throw new TypeError('This operation received an unsupported query parameter or body.');
        if (value === null) continue;
        for (const item of Array.isArray(value) ? value : [value]) {
          if (!['string', 'number', 'boolean'].includes(typeof item)) throw new TypeError('Query values must be scalar values or lists of scalar values.');
          query.append(name, String(item));
        }
      }
      if (query.size) path += `?${query}`;
    }
    return { operation, options, params: snapshot, path, headers, body };
  }

  async execute(prepared) {
    const { operation, options, path, headers, body } = prepared;
    const retries = operation.method === 'GET' ? (options.maxNetworkRetries ?? this.#retries) : 0;
    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) throw new errors.ConnectionError('The API request was cancelled.');
      const controller = new AbortController();
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
      const timer = setTimeout(() => controller.abort(), options.timeout ?? this.#timeout);
      let response;
      let info = null;
      let text;
      const start = performance.now();
      try {
        response = await this.#fetch(this.#base + path, {
          method: operation.method, headers: { ...headers }, body, redirect: 'manual', signal,
        });
        if (!(response instanceof Response)) throw new errors.UnexpectedResponseError('The HTTP transport did not return a Fetch API Response.');
        info = responseInfo(response);
        text = await readBody(response, info);
      } catch (error) {
        const transportFailure = signal.aborted || error instanceof TypeError || error instanceof errors.ConnectionError ||
          (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
        const canRetry = transportFailure && !options.signal?.aborted && attempt < retries;
        const wait = canRetry ? retryDelay(attempt, response?.headers.get('retry-after') ?? null) : null;
        this.#notify(operation, attempt, start, info, wait);
        if (!transportFailure) throw error;
        if (wait === null) throw new errors.ConnectionError(options.signal?.aborted ? 'The API request was cancelled.' : 'The API connection failed or timed out.', info);
        clearTimeout(timer);
        await this.#wait(wait, options.signal);
        continue;
      } finally { clearTimeout(timer); }
      const wait = attempt < retries && RETRY_STATUSES.has(response.status) ? retryDelay(attempt, response.headers.get('retry-after')) : null;
      this.#notify(operation, attempt, start, info, wait);
      if (wait !== null) { await this.#wait(wait, options.signal); continue; }
      return interpret(operation, response, info, text);
    }
  }

  async #wait(ms, signal) {
    try { await delay(ms, undefined, { signal }); }
    catch { throw new errors.ConnectionError('The API request was cancelled.'); }
  }

  #notify(operation, attempt, start, info, wait) {
    if (!this.#observer || this.#observerContext.getStore()) return;
    try {
      const result = this.#observerContext.run(true, () => this.#observer(Object.freeze({ operationId: operation.id, method: operation.method,
        path: operation.path, attempt: attempt + 1, durationMs: performance.now() - start,
        statusCode: info?.statusCode ?? null, requestId: info?.requestId ?? null,
        willRetry: wait !== null, retryDelayMs: wait })));
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
    } catch { /* Diagnostics must not change financial request results. */ }
  }
}

function interpret(operation, response, info, text) {
  if (response.status >= 300 && response.status < 400) throw new errors.UnexpectedResponseError('The API returned a redirect; redirects are not followed.', info);
  if (response.status < 200 || response.status >= 300) {
    let apiError = null;
    try {
      const parsed = parseJson(text);
      validateResponse(parsed, { $ref: '#/components/schemas/ErrorResponse' }, info);
      apiError = parsed.error;
    } catch { /* Non-JSON or malformed error envelopes retain their HTTP category. */ }
    const ErrorClass = ({ 400: errors.InvalidRequestError, 405: errors.InvalidRequestError, 413: errors.InvalidRequestError,
      415: errors.InvalidRequestError, 422: errors.InvalidRequestError, 401: errors.AuthenticationError,
      403: errors.PermissionError, 404: errors.NotFoundError, 409: errors.ConflictError, 429: errors.RateLimitError })[response.status] ?? errors.ApiError;
    throw new ErrorClass(`The API request failed with HTTP ${response.status}.`, info, apiError);
  }
  if (!Object.hasOwn(operation.responses, response.status)) throw new errors.UnexpectedResponseError('The API returned an undocumented success status.', info);
  const schema = operation.responses[response.status];
  if (schema === null) {
    if (text.trim()) throw new errors.UnexpectedResponseError('The API returned a body for an empty response.', info);
    return null;
  }
  const contentType = response.headers.get('content-type');
  if (contentType && !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) throw new errors.UnexpectedResponseError('The API returned a non-JSON success response.', info);
  let resource;
  try { resource = parseJson(text); }
  catch { throw new errors.UnexpectedResponseError('The API returned invalid JSON or an unsafe number.', info); }
  if (!isObject(resource)) throw new errors.UnexpectedResponseError('The API response must be a JSON object.', info);
  validateResponse(resource, schema, info);
  Object.defineProperty(resource, 'lastResponse', { value: info, enumerable: false });
  return resource;
}

module.exports = { Requestor };
