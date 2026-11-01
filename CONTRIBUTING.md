# Contributing

Read `AGENTS.md` and the [maintenance guide](docs/maintenance.md). Preserve JSON
names, integer cents, Unix seconds, omission, null, and the meaning of `202`.
Contract-derived services and types must be generated, not edited by hand.

Run the full gate from the checkout:

```sh
npm run check -- --prepare-tools
npm run check
```

`--prepare-tools` permits the initial preparation of pinned tools in the `.tmp`
cache. Without it, a missing tool or integrity mismatch stops validation.
Nothing is installed globally. `RAIMS_PYTHON` selects the Python executable.

The command invokes the canonical Developer Toolkit validator. It checks the
contract, generated outputs, syntax, compatibility, ESM/CommonJS types,
regressions, and a clean package installation, and audits runtime dependencies.
Physical tests and their results are recreated only in `.tmp`; execution does
not rely on historical workstation suites or call the real financial API.

A clone without the Toolkit cannot pass the full gate. In that case,
`npm run check-source` checks only generated outputs and syntax.

## Public compatibility

`npm run check-compatibility` compares symbols with `contracts/node-api.json`
without changing the baseline. It is independent of OpenAPI: renaming an SDK
method can break an integration even if its HTTP route stays the same.
Changes to types, requiredness, and signatures must be reviewed.

A deliberate baseline update uses `npm run snapshot-api` with prepared tools,
followed by diff review. Do not update the baseline to hide a breaking change
or rewrite it during `npm run generate`. The check accepts clearly compatible
additions and treats complex changes conservatively.

## Validation coverage

Generator or runtime changes need independent scenarios for:

- Every operation and success status, including method, path, query, and JSON.
- POST without a body, JSON in DELETE, `202`, empty responses, and errors without an envelope.
- Null, omission, false, zero, empty maps, and future fields.
- Safe integers, overflow, and fractions that would round to integers.
- Per-request options, concurrent requests, and isolation between clients.
- Read-only retries, `Retry-After`, timeout, and cancellation.
- Pagination in both directions, filters, empty pages, missing cursors, and cycles.
- Blocked redirects and local HTTP using the native transport.
- Original webhook bytes, Base62, rotation, clocks, and ambiguous headers.
- Sanitized diagnostics and callbacks that fail or start other requests.

Use fake transports and loopback receivers. Do not call the real API during
validation: even Sandbox operations can produce external communications.
Tests, simulators, validation dependencies, and reports belong exclusively in
`C:\server\raims\.tmp\raims-node-sdk`, outside this repository. Stop processes
and verify that ports are released before finishing.

Describe Raims features directly. Preserve required licenses and attribution
for incorporated code. Do not include personal data, keys, secrets, or temporary
links in examples or evidence.

Review all modified and new files, `git diff`, and `git diff --cached`.
Keep changes uncommitted and unstaged until explicitly requested.
npm publication, remote repository creation, pushes, and releases are separate steps.
