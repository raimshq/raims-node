'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = JSON.parse(read('contracts/source.json'));
const bytes = fs.readFileSync(path.join(root, 'contracts/openapi.json'));
if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('Pinned OpenAPI checksum does not match source.json.');
const spec = JSON.parse(bytes);
const services = JSON.parse(read('contracts/service-map.json'));
const schemaKeys = new Set(['$ref', 'type', 'format', 'properties', 'required', 'items', 'additionalProperties', 'anyOf', 'oneOf', 'allOf', 'enum', 'const', 'nullable']);
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const schemas = spec.components.schemas;
const operations = {};
const publicName = name => name === 'Error' ? 'ApiErrorData' : name;

function resolve(value) {
  if (!value?.$ref) return value;
  const parts = value.$ref.split('/');
  if (parts[0] !== '#') throw new Error('Only local contract references are supported.');
  const result = parts.slice(1).reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
  if (!result) throw new Error('Unresolved contract reference.');
  return result;
}

function validateSchemaShape(schema, location) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(`Unsupported schema at ${location}.`);
  const structural = ['type', 'properties', 'required', 'items', 'additionalProperties', 'anyOf', 'oneOf', 'allOf', 'enum', 'const', 'nullable'];
  if (Object.hasOwn(schema, 'oneOf') || Object.hasOwn(schema, 'allOf') || schema.nullable === true) {
    throw new Error(`Unsupported schema composition at ${location}; review the SDK before updating the contract.`);
  }
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/components/schemas/') || structural.some(key => Object.hasOwn(schema, key))) {
      throw new Error(`Unsupported schema reference or structural siblings at ${location}.`);
    }
    resolve(schema);
    return;
  }
  if (schema.anyOf) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0 ||
        structural.some(key => key !== 'anyOf' && Object.hasOwn(schema, key))) {
      throw new Error(`Unsupported union structure at ${location}.`);
    }
    schema.anyOf.forEach((variant, index) => validateSchemaShape(variant, `${location}.anyOf[${index}]`));
    return;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const allowed = ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'];
  if (!types.length || new Set(types).size !== types.length || types.some(type => !allowed.includes(type)) ||
      types.filter(type => type !== 'null').length > 1) {
    throw new Error(`Unsupported schema types at ${location}.`);
  }
  if (Object.hasOwn(schema, 'const') && schema.const !== null && !['string', 'number', 'boolean'].includes(typeof schema.const)) {
    throw new Error(`Only scalar const values are supported at ${location}.`);
  }
  if (types.includes('array')) {
    if (!schema.items || Array.isArray(schema.items)) throw new Error(`Unsupported array items at ${location}.`);
    validateSchemaShape(schema.items, `${location}.items`);
  }
  for (const [name, child] of Object.entries(schema.properties || {})) validateSchemaShape(child, `${location}.${name}`);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    validateSchemaShape(schema.additionalProperties, `${location}.additionalProperties`);
  }
}

for (const [name, schema] of Object.entries(schemas)) validateSchemaShape(schema, name);

function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (value === null || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (!schemaKeys.has(key)) continue;
    if (key === 'properties') result[key] = Object.fromEntries(Object.entries(child).map(([n, s]) => [n, compact(s)]));
    else result[key] = compact(child);
  }
  return result;
}

function typeFor(schema, input = false) {
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/components/schemas/')) throw new Error('A type must reference a local component schema.');
    resolve(schema);
    return publicName(schema.$ref.split('/').pop());
  }
  if (schema.anyOf || schema.oneOf) return (schema.anyOf || schema.oneOf).map(s => `(${typeFor(s, input)})`).join(' | ');
  if (schema.allOf) return schema.allOf.map(s => `(${typeFor(s, input)})`).join(' & ');
  if (Array.isArray(schema.type)) return schema.type.map(type => typeFor({ ...schema, type }, input)).join(' | ');
  if (schema.type === 'null') return 'null';
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum?.length) {
    const known = schema.enum.map(x => JSON.stringify(x)).join(' | ');
    return input ? known : `${known} | ${schema.type === 'integer' || schema.type === 'number' ? 'number' : '(string & {})'}`;
  }
  if (schema.type === 'array') return `${input ? '' : 'Readonly'}Array<${typeFor(schema.items || {}, input)}>`;
  if (schema.type === 'object' || schema.properties || schema.additionalProperties !== undefined) {
    const properties = Object.entries(schema.properties || {}).map(([name, child]) => {
      const doc = child.description ? `/** ${child.description.replace(/\*\//g, '* /').replace(/\s+/g, ' ')} */\n` : '';
      return `${doc}${input ? '' : 'readonly '}${JSON.stringify(name)}${schema.required?.includes(name) ? '' : '?'}: ${typeFor(child, input)};`;
    });
    if (schema.additionalProperties === true) properties.push(`${input ? '' : 'readonly '}[key: string]: unknown;`);
    else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') properties.push(`${input ? '' : 'readonly '}[key: string]: ${typeFor(schema.additionalProperties, input)};`);
    return properties.length ? `{\n${properties.join('\n')}\n}` : 'Record<string, unknown>';
  }
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'string' || schema.type === 'boolean') return schema.type;
  if (Object.keys(schema).length === 0) return 'unknown';
  throw new Error('A schema cannot be represented in TypeScript.');
}

for (const [template, item] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(item)) {
    if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(method)) continue;
    if (!op.operationId || !identifier.test(op.operationId) || operations[op.operationId]) throw new Error('Each operation needs a unique valid operationId.');
    if (op['x-raims-availability'] && op['x-raims-availability'] !== 'production') throw new Error('The SDK cannot include unpublished operations.');
    if (!(op.security || spec.security || []).some(s => Object.hasOwn(s, 'BearerAuth'))) throw new Error('An operation does not support API key authentication.');
    const parameters = [...(item.parameters || []), ...(op.parameters || [])].map(resolve);
    for (const parameter of parameters) {
      if (!['path', 'query', 'header'].includes(parameter.in)) throw new Error('Unsupported operation parameter location.');
      validateSchemaShape(parameter.schema, `${op.operationId}.${parameter.name}`);
      if (parameter.in === 'path' && parameter.schema.type !== 'string') throw new Error('Only string path identifiers are supported.');
      if (parameter.in === 'query' && (parameter.style && parameter.style !== 'form' || parameter.explode === false)) {
        throw new Error('Unsupported query parameter serialization.');
      }
    }
    const query = Object.fromEntries(parameters.filter(p => p.in === 'query').map(p => [p.name, compact(p.schema)]));
    const querySchema = { type: 'object', properties: Object.fromEntries(parameters.filter(p => p.in === 'query').map(p => [p.name, p.schema])), required: parameters.filter(p => p.in === 'query' && p.required).map(p => p.name) };
    for (const parameter of parameters.filter(p => p.in === 'header')) {
      if (parameter.name !== 'Idempotency-Key' && parameter['x-raims-authentication'] !== 'oauth' && parameter.name !== 'X-Raims-Environment') throw new Error('Unsupported header parameter in the contract.');
    }
    const bodySchema = op.requestBody ? resolve(op.requestBody).content?.['application/json']?.schema : null;
    if (op.requestBody && !bodySchema) throw new Error('Only JSON request bodies are supported.');
    if (bodySchema && Object.keys(query).length) throw new Error('Operations with both a JSON body and query parameters require explicit SDK support.');
    if (bodySchema) validateSchemaShape(bodySchema, `${op.operationId}.body`);
    const responses = {};
    for (const [status, response] of Object.entries(op.responses)) {
      if (!/^2\d\d$/.test(status)) continue;
      const resolved = resolve(response);
      responses[status] = resolved.content?.['application/json']?.schema ?? null;
      if (resolved.content && !responses[status]) throw new Error('Only JSON success responses are supported.');
      if (responses[status]) validateSchemaShape(responses[status], `${op.operationId}.response.${status}`);
    }
    if (Object.keys(responses).length === 0) throw new Error('An operation has no success responses.');
    const responseSchemas = Object.values(responses).filter(Boolean).map(resolve);
    const paginated = responseSchemas.some(s => s.properties?.list && s.properties?.page);
    if (paginated && (responseSchemas.some(s => !s.properties?.list || !s.properties?.page) || method !== 'get' || !query.after || !query.before)) throw new Error('Pagination contract changed.');
    operations[op.operationId] = { id: op.operationId, method: method.toUpperCase(), path: template,
      pathParams: [...template.matchAll(/\{([^}]+)\}/g)].map(m => m[1]), query,
      body: Boolean(bodySchema), idempotency: parameters.some(p => p.in === 'header' && p.name === 'Idempotency-Key'),
      maxBodyBytes: op['x-raims-max-body-bytes'] ?? null, responses: Object.fromEntries(Object.entries(responses).map(([status, schema]) => [status, schema && compact(schema)])), paginated,
      _params: bodySchema || querySchema, _required: bodySchema ? Boolean(resolve(bodySchema).required?.length) : Boolean(querySchema.required.length),
      _responseSchemas: responses, _summary: op.summary || op.operationId };
  }
}

const mapped = Object.entries(services).flatMap(([name, methods]) => {
  if (!identifier.test(name)) throw new Error('Invalid service identifier.');
  return Object.entries(methods).map(([method, id]) => {
    if (!identifier.test(method) || !Object.hasOwn(operations, id)) throw new Error('Invalid service method mapping.');
    return id;
  });
});
if (new Set(mapped).size !== mapped.length || mapped.length !== Object.keys(operations).length || mapped.length !== source.operations) throw new Error('The service map must cover each published operation exactly once.');
if (source.api_version !== spec.info.version) throw new Error('API version does not match source metadata.');

const header = '// Generated by scripts/generate.cjs. Do not edit.\n';
const serviceTypes = [];
const paramsTypes = [];
const reference = ['# Node.js SDK reference', '', 'Methods, inputs, and responses for integrating with the Raims public API.', '', '| Service and method | HTTP operation | Input | Response |', '| --- | --- | --- | --- |'];
for (const [name, methods] of Object.entries(services)) {
  const signatures = [];
  for (const [method, id] of Object.entries(methods)) {
    const op = operations[id];
    const hasParams = op.body || Object.keys(op.query).length > 0;
    const args = op.pathParams.map(p => `${p}: string`);
    if (hasParams) {
      paramsTypes.push(`export type ${id}Params = ${typeFor(op._params, true)};`);
      args.push(`params${op._required ? '' : '?'}: ${id}Params`);
    }
    args.push('options?: RequestOptions');
    const response = [...new Set(Object.values(op._responseSchemas).map(s => s ? typeFor(s) : 'null'))].join(' | ');
    let result = `Promise<Response<${response}>>`;
    if (op.paginated) {
      const resource = resolve(Object.values(op._responseSchemas).find(Boolean));
      const item = typeFor(resolve(resource.properties.list).items);
      result = `ApiListPromise<${item}, ${response}>`;
    }
    signatures.push(`/** ${op._summary.replace(/\*\//g, '* /')} */\n${method}(${args.join(', ')}): ${result};`);
    const servicePath = name === 'simulationCharges' ? 'simulations.charges' : name === 'simulationRefunds' ? 'simulations.refunds' : name;
    reference.push(`| \`${servicePath}.${method}\` | \`${op.method} ${op.path}\` | ${hasParams ? `\`${id}Params\`` : '-'} | \`${response.replace(/\|/g, '\\|')}\` |`);
  }
  if (name === 'webhooks') signatures.push('constructEvent: WebhookVerifier["constructEvent"];', 'verifySignature: WebhookVerifier["verifySignature"];');
  const typeName = name[0].toUpperCase() + name.slice(1) + 'Service';
  serviceTypes.push(`export interface ${typeName} {\n${signatures.join('\n')}\n}`);
}

const manualTypes = `
export interface ClientOptions {
  apiBase?: string;
  /** Timeout per HTTP attempt, including the response body, in milliseconds. */
  timeout?: number;
  /** Applied only to GET requests. Defaults to zero. */
  maxNetworkRetries?: number;
  fetch?: typeof globalThis.fetch;
  requestObserver?: (diagnostics: RequestDiagnostics) => void | Promise<void>;
}
export interface RequestOptions { apiKey?: string; idempotencyKey?: string; timeout?: number; maxNetworkRetries?: number; signal?: AbortSignal; }
export interface LastResponse { readonly statusCode: number; readonly requestId: string | null; readonly idempotencyReplayed: boolean; readonly retryAfter: string | null; }
export interface RequestDiagnostics { readonly operationId: string; readonly method: string; readonly path: string; readonly attempt: number; readonly durationMs: number; readonly statusCode: number | null; readonly requestId: string | null; readonly willRetry: boolean; readonly retryDelayMs: number | null; }
export type Response<T> = T extends null ? null : T & { readonly lastResponse: LastResponse };
export type ApiPage<T, P> = Response<P> & { nextPage(): Promise<ApiPage<T, P> | null>; previousPage(): Promise<ApiPage<T, P> | null>; };
export interface ApiListPromise<T, P> extends Promise<ApiPage<T, P>>, AsyncIterable<T> {
  autoPagingEach(callback: (item: T) => void | boolean | Promise<void | boolean>): Promise<void>;
  autoPagingToArray(options: { limit: number }): Promise<T[]>;
}
export interface WebhookOptions { tolerance?: number; now?: number; }
export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;
export interface WebhookVerifier {
  constructEvent(payload: string | Uint8Array, headers: WebhookHeaders, secret: string, options?: WebhookOptions): Record<string, unknown>;
  verifySignature(payload: string | Uint8Array, headers: WebhookHeaders, secret: string, options?: WebhookOptions): void;
}
export const Webhook: WebhookVerifier;
export class RaimsError extends globalThis.Error {
  constructor(message: string, lastResponse?: LastResponse | null, apiError?: ApiErrorData | null);
  readonly lastResponse: LastResponse | null;
  readonly statusCode: number | null;
  readonly requestId: string | null;
  readonly code: string | null;
  readonly apiError: ApiErrorData | null;
  toJSON(): { name: string; message: string; statusCode: number | null; requestId: string | null; code: string | null; };
}
export class ApiError extends RaimsError {}
export class AuthenticationError extends ApiError {}
export class PermissionError extends ApiError {}
export class NotFoundError extends ApiError {}
export class ConflictError extends ApiError {}
export class RateLimitError extends ApiError {}
export class InvalidRequestError extends ApiError {}
export class ConnectionError extends RaimsError {}
export class UnexpectedResponseError extends RaimsError {}
export class SignatureVerificationError extends RaimsError {}
`;
const models = Object.entries(schemas).map(([name, schema]) => `export type ${publicName(name)} = ${typeFor(schema, name.endsWith('Request'))};`);
const serviceProperties = Object.keys(services).filter(n => !n.startsWith('simulation')).map(n => `readonly ${n}: Raims.${n[0].toUpperCase() + n.slice(1)}Service;`);
const declaration = header + `declare class Raims {
constructor(apiKey: string, options?: Raims.ClientOptions);
static readonly VERSION: ${JSON.stringify(JSON.parse(read('package.json')).version)};
${serviceProperties.join('\n')}
readonly simulations: { readonly charges: Raims.SimulationChargesService; readonly refunds: Raims.SimulationRefundsService; };
toJSON(): { sdk: string; version: string; };
}
import RaimsConstructor = Raims;
declare namespace Raims {
export import Raims = RaimsConstructor;
export import RaimsClient = RaimsConstructor;
${manualTypes}
${models.join('\n')}
${paramsTypes.join('\n')}
${serviceTypes.join('\n')}
}
export = Raims;
`;
const errorNames = ['RaimsError', 'ApiError', 'AuthenticationError', 'PermissionError', 'NotFoundError', 'ConflictError', 'RateLimitError', 'InvalidRequestError', 'ConnectionError', 'UnexpectedResponseError', 'SignatureVerificationError'];
const typeNames = [...manualTypes.matchAll(/export (?:interface|type) (\w+)/g)].map(m => m[1]).concat(Object.keys(schemas).map(publicName), paramsTypes.map(t => /export type (\w+)/.exec(t)[1]), serviceTypes.map(t => /export interface (\w+)/.exec(t)[1]));
const generic = { Response: 'T', ApiPage: 'T, P', ApiListPromise: 'T, P' };
const esmTypes = header + `import Raims from './index.cjs';\nexport default Raims;\nexport { Raims, Raims as RaimsClient };\nexport const Webhook: typeof Raims.Webhook;\n` +
  errorNames.map(name => `export const ${name}: typeof Raims.${name};\nexport type ${name} = Raims.${name};`).join('\n') + '\n' +
  typeNames.map(name => `export type ${name}${generic[name] ? `<${generic[name]}>` : ''} = Raims.${name}${generic[name] ? `<${generic[name]}>` : ''};`).join('\n') + '\n';
const runtimeOps = Object.fromEntries(Object.entries(operations).map(([id, op]) => [id, Object.fromEntries(Object.entries(op).filter(([key]) => !key.startsWith('_')))]));
const outputs = {
  'src/generated/contract.json': JSON.stringify({ source: { revision: source.revision, sha256: source.sha256 }, services, operations: runtimeOps, schemas: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, compact(schema)])) }, null, 2) + '\n',
  'types/index.d.cts': declaration,
  'types/index.d.mts': esmTypes,
  'docs/reference.md': reference.join('\n') + '\n',
};
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Unsupported generator option.');
for (const [file, content] of Object.entries(outputs)) {
  const full = path.join(root, file);
  if (check) {
    if (!fs.existsSync(full) || fs.readFileSync(full, 'utf8') !== content) throw new Error(`Generated output differs: ${file}`);
  } else { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content); }
}
console.log(`${check ? 'Checked' : 'Generated'} ${mapped.length} operations and ${Object.keys(schemas).length} schemas.`);
