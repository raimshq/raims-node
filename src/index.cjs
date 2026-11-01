'use strict';

const { Requestor } = require('./requestor.cjs');
const { collectionPromise, attachPageNavigation } = require('./pagination.cjs');
const { operations, services } = require('./generated/contract.json');
const errors = require('./errors.cjs');
const Webhook = require('./webhook.cjs');
const { version } = require('../package.json');

function buildService(requestor, methods) {
  const service = {};
  for (const [name, operationId] of Object.entries(methods)) {
    const operation = operations[operationId];
    service[name] = (...args) => {
      const count = operation.pathParams.length;
      const hasParams = operation.body || Object.keys(operation.query).length > 0;
      const maxArgs = count + (hasParams ? 1 : 0) + 1;
      if (args.length > maxArgs) throw new TypeError('This operation received too many arguments.');
      const path = args.slice(0, count);
      const params = hasParams && args[count] !== undefined ? args[count] : {};
      const rawOptions = args[count + (hasParams ? 1 : 0)];
      const options = rawOptions === undefined ? {} : rawOptions;
      const prepared = requestor.prepare(operation, path, params, options);
      function load(nextParams) {
        const next = requestor.prepare(operation, path, nextParams, prepared.options);
        return requestor.execute(next).then(page => attachPageNavigation(page, load, next.params));
      }
      const promise = requestor.execute(prepared);
      if (!operation.paginated) return promise;
      return collectionPromise(promise.then(page => attachPageNavigation(page, load, prepared.params)), load, prepared.params);
    };
  }
  return service;
}

class Raims {
  constructor(apiKey, options = {}) {
    const requestor = new Requestor(apiKey, options);
    const simulations = {};
    for (const [name, methods] of Object.entries(services)) {
      const service = buildService(requestor, methods);
      if (name === 'webhooks') Object.assign(service, Webhook);
      if (name === 'simulationCharges') simulations.charges = Object.freeze(service);
      else if (name === 'simulationRefunds') simulations.refunds = Object.freeze(service);
      else Object.defineProperty(this, name, { value: Object.freeze(service), enumerable: true });
    }
    Object.defineProperty(this, 'simulations', { value: Object.freeze(simulations), enumerable: true });
    Object.freeze(this);
  }
  toJSON() { return { sdk: 'RaimsNode', version: Raims.VERSION }; }
  [Symbol.for('nodejs.util.inspect.custom')]() { return this.toJSON(); }
}

Object.assign(Raims, { Raims, RaimsClient: Raims, VERSION: version, Webhook, ...errors });
module.exports = Raims;
