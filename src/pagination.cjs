'use strict';

const { UnexpectedResponseError } = require('./errors.cjs');
const { boundedInteger } = require('./validation.cjs');

function collectionPromise(firstPage, load, params) {
  async function* iterate() {
    let page = await firstPage;
    const seen = new Set();
    if (params.after != null) seen.add(params.after);
    while (true) {
      for (const item of page.list) yield item;
      if (!page.page.has_next) return;
      const cursor = page.page.next_after;
      if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw new UnexpectedResponseError('Pagination returned a missing or repeated cursor.', page.lastResponse);
      seen.add(cursor);
      page = await load({ ...params, before: undefined, after: cursor });
    }
  }
  Object.defineProperties(firstPage, {
    [Symbol.asyncIterator]: { value: iterate },
    autoPagingEach: { value: async callback => {
      // This helper owns the pending request even when its arguments are invalid.
      void firstPage.catch(() => {});
      if (typeof callback !== 'function') throw new TypeError('autoPagingEach requires a callback.');
      for await (const item of { [Symbol.asyncIterator]: iterate }) if (await callback(item) === false) break;
    } },
    autoPagingToArray: { value: async options => {
      void firstPage.catch(() => {});
      if (!options || Object.keys(options).some(k => k !== 'limit')) throw new TypeError('autoPagingToArray requires a limit.');
      const limit = boundedInteger(options.limit, 1, 1000000, 'limit');
      const result = [];
      for await (const item of { [Symbol.asyncIterator]: iterate }) { result.push(item); if (result.length === limit) break; }
      return result;
    } },
  });
  return firstPage;
}

function attachPageNavigation(page, load, params) {
  for (const [name, flag, cursorKey, queryKey, opposite] of [
    ['nextPage', 'has_next', 'next_after', 'after', 'before'],
    ['previousPage', 'has_previous', 'previous_before', 'before', 'after'],
  ]) {
    Object.defineProperty(page, name, { value: async () => {
      if (!page.page[flag]) return null;
      const cursor = page.page[cursorKey];
      if (typeof cursor !== 'string' || !cursor || cursor === params[queryKey]) throw new UnexpectedResponseError('Pagination returned a missing or repeated cursor.', page.lastResponse);
      return load({ ...params, [opposite]: undefined, [queryKey]: cursor });
    }, enumerable: false });
  }
  return page;
}

module.exports = { collectionPromise, attachPageNavigation };
