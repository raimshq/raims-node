# Contract and maintenance

## Source and generation

`contracts/source.json` records the immutable public revision, SHA-256, HTTP
version, deployed revision, and operation count.
`contracts/openapi.json` retains the bytes from that revision of
[raimshq/openapi](https://github.com/raimshq/openapi). The canonical source
belongs to the Public API; the SDK consumes only the confirmed published surface.

```sh
npm run generate
npm run check-generated
npm run check-source
npm run check-compatibility
npm run check
```

Generation is offline, verifies the checksum, and requires
`contracts/service-map.json` to cover each operation exactly once. It produces
the transport catalog, TypeScript models and services, and method reference.
`--check` compares outputs without rewriting them. The SDK supports API-key
authentication; OAuth-only contract parameters are excluded from signatures
and transport.

The generator rejects combinations that require additional support: a body and
query in one operation, query serialization other than form, unsupported parameter
locations, non-string path identifiers, `oneOf`/`allOf`, legacy nullability, and
multiple non-null types. References with structural changes also require review.
Do not remove these guards without aligning types, transport, validation, and regressions.

| Path | Responsibility |
| --- | --- |
| `src/index.cjs` and `src/index.mjs` | CommonJS/ESM composition and exports |
| `src/requestor.cjs` | Configuration, transport, read retries, and HTTP errors |
| `src/validation.cjs` | JSON, numeric precision, and response structure |
| `src/pagination.cjs` | Cursors, navigation, and iterators |
| `src/webhook.cjs` | Original-body authentication |
| `src/errors.cjs` | Error categories and diagnostics |
| `scripts/generate.cjs` | Deterministic generation from the pinned contract |

When updating the contract, verify the public manifest and checksum before
replacing the snapshot and source metadata. Review type, status, required-field,
nullability, authentication, environment, pagination, and idempotency changes.
Do not edit the snapshot to invent endpoints or rules. Update the service map,
regenerate outputs, and review the full diff and effects on consuming applications.

## Local validation

`npm run check` invokes `Developer-Toolkit/scripts/release-preflight/node_sdk.py`.
The adapter recreates suites and consumers from its versioned recipes and writes
physical files only to `.tmp`. It checks sources before and after execution,
the pinned contract, generation, syntax, types, compatibility, and the installed
package using fake transports and loopback receivers.

Initial preparation uses `npm run check -- --prepare-tools`. TypeScript and Node.js
types are pinned to exact versions in the cache, with a lockfile and integrity
checks. `RAIMS_PYTHON` selects the shortcut's Python executable. Missing or changed
tools, incomplete audits, and source drift block validation.

A run passes only after the final integrity check. If that check fails, the run
fails even if previous tests passed. Commands and their descendants are stopped
when the main process exits normally as well. The engineering gate requires
Windows or Linux process containment; this does not change the runtime
requirements for the package installed by an integrator.

`npm run check-source` is a partial generation and syntax check available without
the Toolkit. An isolated clone cannot claim full gate approval. All tests,
simulators, consumers, and reports remain in
`C:\server\raims\.tmp\raims-node-sdk`.

The `prepack` lifecycle invokes the full gate. Inside that gate, the package is
created with `--ignore-scripts` to avoid recursion, installed in a clean consumer,
and checked in ESM and CommonJS. The artifact contains only runtime, types,
integrator guides, and the license. Contracts, the generator, the compatibility
baseline, internal instructions, tools, and tests are excluded.

## Library compatibility

`contracts/node-api.json` records the public TypeScript symbols and runtime
exports. `npm run check-compatibility` compares the implementation without
rewriting this baseline. It is independent of HTTP generation and is not
changed by `npm run generate`.

The check rejects removals, renames, and incompatible changes to types,
requiredness, and parameters, including new required methods in structural
types. Optional methods can be added without requiring existing consumers
to change. Clearly compatible additions are accepted; complex changes are
compared conservatively. TypeScript 6.0.3 extracts the declarations.
`RAIMS_TYPESCRIPT` or `--typescript` can select that version's module; the gate
uses the copy whose integrity it verified.

A deliberate baseline update uses `npm run snapshot-api`. Review the diff,
the meaning of the changes, and affected consumers before accepting it.
Updating the manifest does not make a breaking change safe.

## Distribution and support

The public repository is `raimshq/raims-node`. Initial distribution uses GitHub
only: source on `main`, a tag matching `package.json`, and a release containing
`raims-node.tgz` and `SHA256SUMS`. Use the package produced by the approved gate.
Verify the tag's commit, download the asset, compare its checksum, and validate
a clean installation. The package's internal name is `raims`.

The `public-sdk-source` profile requires the Commit and Deploy gates, including
JavaScript SAST, the runtime audit, and destination checks. This delivery has no
executable workflows. Future CI must use authorized AWS runners and an immutable
Toolkit revision containing the Node.js validator.

npm publication requires its own authorization, confirmed ownership of the
package name, successful validation of the same commit in authorized CI, and
installation from the registry. Do not add credentials to sources or logs or
create infrastructure to bypass the release process.

When publishing the BR/EN guides in `raims-developer-docs`, describe the
available distribution and use the actual availability date in the changelog.
Publishing that site requires separate authorization. It already feeds support;
regenerate its catalogs and validate bot guidance. Cover backend use,
permissions, environment selection by key, simulations, pagination, idempotency,
`202`, errors, and webhooks. The library does not require account data or new
financial tools in the chat context contract.

The SDK does not change the Public API or the HTTP behavior consumed by the
CLI, PHP/.NET SDKs, or MCP. These consumers do not need regeneration for this
delivery. Track availability, support integration, and publication in the private
workspace backlog maintained outside Git until the authorized destinations
have been verified.
