# Security

Report vulnerabilities privately to `security@raims.com`, including the SDK
version, impact, and a minimal reproduction using synthetic data. Do not open
a public issue containing credentials, personal data, or access to account resources.

Run the SDK on the server. Keep TLS verification and your application's access
controls enabled. Protect keys, secrets, financial payloads, and temporary links,
including in error handlers and logs. Authenticate webhooks using the original
bytes and persist event deduplication before applying their effects.
