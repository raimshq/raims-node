'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '..');
const workspace = [path.dirname(source), path.dirname(path.dirname(source))].find(candidate => fs.existsSync(path.join(candidate, 'Developer-Toolkit/scripts/release-preflight/node_sdk.py'))) || path.dirname(source);
const validator = path.join(workspace, 'Developer-Toolkit/scripts/release-preflight/node_sdk.py');

if (!fs.existsSync(validator) || !fs.existsSync(path.join(workspace, 'AGENTS.md'))) {
  console.error('Validation requires the Raims engineering workspace and its Developer-Toolkit checkout. No checks were run.');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.env.RAIMS_PYTHON || 'python', [validator, '--source', source,
    '--workspace', workspace, '--node', process.execPath, ...process.argv.slice(2)], {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (result.error) {
    console.error('The canonical SDK validator could not start. Configure RAIMS_PYTHON with a Python 3.8 or newer executable.');
  }
  process.exitCode = result.status ?? 1;
}
