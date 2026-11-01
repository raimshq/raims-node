'use strict';

const { UnexpectedResponseError } = require('./errors.cjs');
const { schemas } = require('./generated/contract.json');
const isProxy = require('node:util').types.isProxy;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOptions(value, allowed, label) {
  if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => !allowed.includes(key))) {
    throw new TypeError(`${label} contains an unsupported option or is not a plain object.`);
  }
}

function boundedInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

// Examine number tokens before JSON.parse can round financial integers or fractions.
function parseJson(text) {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '\\') i++;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '-' || (char >= '0' && char <= '9')) {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
      if (!match) continue;
      const token = match[0];
      const number = Number(token);
      if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error('Unsafe JSON number.');
      if (Number.isInteger(number)) {
        const [mantissa, power = '0'] = token.toLowerCase().split('e');
        const fraction = mantissa.split('.')[1]?.length ?? 0;
        const digits = mantissa.replace(/[-.]/g, '');
        const shift = Number(power) - fraction;
        if (shift < 0 && !/^0*$/.test(digits.slice(Math.max(0, digits.length + shift)))) {
          throw new Error('JSON fraction would be rounded to an integer.');
        }
      }
      i += token.length - 1;
    }
  }
  return JSON.parse(text);
}

function validateResponse(value, schema, response, depth = 0) {
  if (depth > 100) throw new UnexpectedResponseError('The response nesting exceeds the supported depth.', response);
  const fail = () => { throw new UnexpectedResponseError('The API response does not match the published structure.', response); };
  if (schema.$ref) {
    const target = schemas[schema.$ref.split('/').pop()];
    if (!target) return fail();
    return validateResponse(value, target, response, depth + 1);
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return fail();
  if (schema.anyOf || schema.oneOf) {
    for (const variant of schema.anyOf || schema.oneOf) {
      try { validateResponse(value, variant, response, depth + 1); return; }
      catch (error) { if (!(error instanceof UnexpectedResponseError)) throw error; }
    }
    return fail();
  }
  if (schema.allOf) for (const part of schema.allOf) validateResponse(value, part, response, depth + 1);
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null) { if (!types.includes('null') && !schema.nullable) fail(); return; }
  if (types.length === 1 && types[0] === 'null') return fail();
  const type = types.find(t => t !== 'null');
  if (type === 'object') {
    if (!isObject(value)) return fail();
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail();
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties || {}, key)) validateResponse(child, schema.properties[key], response, depth + 1);
      else if (isObject(schema.additionalProperties)) validateResponse(child, schema.additionalProperties, response, depth + 1);
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) return fail();
    for (const child of value) validateResponse(child, schema.items || {}, response, depth + 1);
  } else if (type === 'integer') { if (!Number.isSafeInteger(value)) fail(); }
  else if (type === 'number') { if (typeof value !== 'number' || !Number.isFinite(value)) fail(); }
  else if (type === 'string' || type === 'boolean') { if (typeof value !== type) fail(); }
  else if (type === 'null') fail();
  // Future fields and enum values are preserved; business validation belongs to the API.
}

function serializeParams(value) {
  const seen = new Set();
  function descriptorFor(item, key) {
    for (let current = item; current !== null; current = Object.getPrototypeOf(current)) {
      if (isProxy(current)) throw new TypeError('Request parameters must contain only JSON values.');
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return descriptor;
    }
  }
  function propertyValue(descriptor, depth) {
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Request parameters cannot contain getters.');
    return visit(descriptor.value, depth);
  }
  function visit(item, depth) {
    if (depth > 100) throw new TypeError('Request parameters are nested too deeply.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || item === undefined) return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))) {
        throw new TypeError('Request numbers must be finite and integers must be safe.');
      }
      return item;
    }
    if (typeof item !== 'object' || isProxy(item) || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) {
      throw new TypeError('Request parameters must contain only JSON values.');
    }
    if (seen.has(item)) throw new TypeError('Request parameters cannot contain cycles.');
    seen.add(item);
    const serializer = descriptorFor(item, 'toJSON');
    if (serializer && (!Object.hasOwn(serializer, 'value') || typeof serializer.value === 'function')) {
      throw new TypeError('Request parameters cannot override JSON serialization.');
    }
    const array = Array.isArray(item);
    const snapshot = array ? [] : Object.create(null);
    if (array) {
      Object.setPrototypeOf(snapshot, null);
      snapshot.length = Object.getOwnPropertyDescriptor(item, 'length').value;
    }
    for (const key of Object.keys(item)) {
      const child = propertyValue(Object.getOwnPropertyDescriptor(item, key), depth + 1);
      const index = array ? Number(key) : null;
      if (!array || (Number.isInteger(index) && index >= 0 && index < snapshot.length && String(index) === key)) {
        snapshot[key] = child;
      }
    }
    if (array) {
      // JSON arrays include non-enumerable and inherited indices, and turn holes into null.
      for (let index = 0; index < snapshot.length; index++) {
        if (Object.hasOwn(snapshot, index)) continue;
        const descriptor = descriptorFor(item, String(index));
        snapshot[index] = descriptor ? propertyValue(descriptor, depth + 1) : undefined;
      }
    }
    seen.delete(item);
    return snapshot;
  }
  return JSON.stringify(visit(value, 0));
}

module.exports = { isObject, assertOptions, boundedInteger, parseJson, validateResponse, serializeParams };
