'use strict';

const inspect = Symbol.for('nodejs.util.inspect.custom');

class RaimsError extends Error {
  constructor(message, lastResponse = null, apiError = null) {
    super(message);
    this.name = new.target.name;
    this.lastResponse = lastResponse;
    this.statusCode = lastResponse?.statusCode ?? null;
    this.requestId = lastResponse?.requestId ?? null;
    this.code = typeof apiError?.code === 'string' && /^[A-Z0-9_]{1,128}$/.test(apiError.code) ? apiError.code : null;
    Object.defineProperty(this, 'apiError', { value: apiError, enumerable: false });
  }
  toJSON() {
    return { name: this.name, message: this.message, statusCode: this.statusCode, requestId: this.requestId, code: this.code };
  }
  [inspect]() { return this.toJSON(); }
}
class ApiError extends RaimsError {}
class AuthenticationError extends ApiError {}
class PermissionError extends ApiError {}
class NotFoundError extends ApiError {}
class ConflictError extends ApiError {}
class RateLimitError extends ApiError {}
class InvalidRequestError extends ApiError {}
class ConnectionError extends RaimsError {}
class UnexpectedResponseError extends RaimsError {}
class SignatureVerificationError extends RaimsError {}

module.exports = { RaimsError, ApiError, AuthenticationError, PermissionError, NotFoundError,
  ConflictError, RateLimitError, InvalidRequestError, ConnectionError, UnexpectedResponseError, SignatureVerificationError };
