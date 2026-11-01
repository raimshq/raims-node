'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (process.argv.length !== 2) throw new Error('check-source does not accept arguments.');

function run(arguments_) {
  const result = spawnSync(process.execPath, arguments_, { cwd: root, stdio: 'inherit' });
  if (result.error) throw new Error('Unable to start the source check.');
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['scripts/generate.cjs', '--check']);
for (const directory of ['src', 'scripts']) {
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Source checks do not accept symbolic links.');
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && /\.(?:cjs|mjs|js)$/.test(entry.name)) run(['--check', full]);
    }
  }
  visit(path.join(root, directory));
}
console.log('Generated outputs and JavaScript syntax checked; full validation uses npm run check.');
