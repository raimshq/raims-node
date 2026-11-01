'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { SignatureVerificationError } = require('./errors.cjs');
const { assertOptions, boundedInteger, isObject, parseJson } = require('./validation.cjs');
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function readHeader(headers, name) {
  let values;
  if (headers instanceof Headers) values = [headers.get(name)];
  else if (isObject(headers)) values = Object.entries(headers).filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
  else throw new SignatureVerificationError('Webhook headers must be an HTTP header collection.');
  if (values.length !== 1) throw new SignatureVerificationError('A webhook signing header is missing or occurs more than once.');
  let value = values[0];
  if (Array.isArray(value) && value.length === 1) value = value[0];
  if (typeof value !== 'string' || !value || /[\x00-\x08\x0a-\x1f\x7f]/.test(value)) throw new SignatureVerificationError('A webhook signing header is invalid.');
  return value;
}

function decodeSecret(secret) {
  if (typeof secret !== 'string' || !/^whsec_[0-9A-Za-z]{1,43}$/.test(secret)) throw new SignatureVerificationError('The webhook signing secret is invalid.');
  const encoded = secret.slice(6);
  if (encoded.length > 1 && encoded[0] === '0') throw new SignatureVerificationError('The webhook signing secret is invalid.');
  let value = 0n;
  for (const char of encoded) value = value * 62n + BigInt(ALPHABET.indexOf(char));
  if (value >= (1n << 256n)) throw new SignatureVerificationError('The webhook signing secret is invalid.');
  const key = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) { key[i] = Number(value & 255n); value >>= 8n; }
  return key;
}

function verifySignature(payload, headers, secret, options = {}) {
  assertOptions(options, ['tolerance', 'now'], 'Webhook options');
  const tolerance = boundedInteger(options.tolerance ?? 300, 0, Number.MAX_SAFE_INTEGER, 'tolerance');
  const now = boundedInteger(options.now ?? Math.floor(Date.now() / 1000), 0, Number.MAX_SAFE_INTEGER, 'now');
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload) && !(payload instanceof Uint8Array)) throw new SignatureVerificationError('The webhook body must contain the original HTTP bytes.');
  const id = readHeader(headers, 'webhook-id');
  const timestamp = readHeader(headers, 'webhook-timestamp');
  const signature = readHeader(headers, 'webhook-signature');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new SignatureVerificationError('The webhook delivery ID is invalid.');
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(Number(timestamp) - now) > tolerance) throw new SignatureVerificationError('The webhook timestamp is invalid or outside the allowed tolerance.');
  const expected = createHmac('sha256', decodeSecret(secret)).update(`${id}.${timestamp}.`).update(payload).digest();
  for (const candidate of signature.split(',')) {
    const match = /^v1=([0-9a-f]{64})$/i.exec(candidate.trim());
    if (match && timingSafeEqual(expected, Buffer.from(match[1], 'hex'))) return;
  }
  throw new SignatureVerificationError('No webhook signature matches the configured secret.');
}

function constructEvent(payload, headers, secret, options = {}) {
  verifySignature(payload, headers, secret, options);
  let event;
  try {
    const text = typeof payload === 'string' ? payload : new TextDecoder('utf-8', { fatal: true }).decode(payload);
    event = parseJson(text);
  } catch { throw new SignatureVerificationError('The authenticated webhook body is not valid JSON or contains an unsafe number.'); }
  if (!isObject(event)) throw new SignatureVerificationError('The authenticated webhook body must be a JSON object.');
  return event;
}

module.exports = Object.freeze({ verifySignature, constructEvent });
