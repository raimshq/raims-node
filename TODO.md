# TODO

- [x] Complete canonical local validation through the Developer Toolkit, with
  pinned tools, suites recreated in `.tmp`, ESM/CommonJS types, a runtime audit,
  and a clean package installation. Integrate the preflight profile without
  changing other SDKs.
- [x] Check the independent public-symbol baseline and generator guards for
  unsupported contract combinations, with compatibility and rejection
  regressions in isolated copies.
- [x] Prepare GitHub-only distribution in `raimshq/raims-node`, with official
  metadata, the `public-sdk-source` profile, JavaScript SAST, an installable
  package, and release installation instructions. Verify the tag, commit,
  checksums, and asset installation when completing publication.
- [ ] Prepare npm distribution: confirm the name `raims` and its ownership,
  bind SAST and CI on authorized runners to an immutable Toolkit revision,
  validate the same commit, and verify registry installation after authorized
  publication. A GitHub release does not confirm npm availability.
- [ ] Include the Node.js SDK in support context and knowledge sources for its
  initial distribution. Create the BR/EN guides in `raims-developer-docs`,
  covering purpose, when to suggest the library, installation, backend use,
  keys, permissions, environment, simulations, availability, limits,
  pagination, idempotency, pending results, errors, and webhooks. Check the map
  in `Raims-Chat/docs/knowledge-sources.md`, regenerate the existing catalog,
  and validate bot guidance in both languages. The SDK adds no support states
  or financial queries: the current context contract and tools need no change.
  Complete this item only after checking the package, published sources,
  catalogs, and guidance.
- [ ] Publish the Node.js SDK changelog entry in
  `raims-developer-docs/content/docs/changelog/post` using the actual
  availability date and links to the guides and confirmed version. Include
  pagination-helper unhandled-rejection protection, fixed response-value
  validation, invalid error-envelope handling, `Retry-After` on interrupted
  responses, named-export type and namespace consistency in ESM/CommonJS,
  and cancellation normalization with custom reasons. Include the fix that
  allows setting and removing the `toJSON` metadata key when its value is a
  string or `null`, and protection that rejects getters and custom serializers
  in arrays before preparing request bodies, preserving the submitted data.
  The site entry remains pending until authorized publication; GitHub
  availability is identified by the repository release.
