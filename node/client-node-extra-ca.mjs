// NODE_EXTRA_CA_CERTS demo — no explicit ca option
// Relies entirely on NODE_EXTRA_CA_CERTS being set in the environment.
// Works for both node:https and undici because both use node:tls under the hood.
// Setting connect.ca or requestTls.ca in code would override NODE_EXTRA_CA_CERTS.
//
// Usage:
//   NODE_EXTRA_CA_CERTS=self-signed/cert.pem node client-node-extra-ca.mjs
//   (or set via Dockerfile ENV — see Dockerfile.node)

import { fetch } from 'undici';

try {
  const host = process.env.TLS_HOST ?? 'localhost';
  const res = await fetch(`https://${host}:8443/hello`);
  process.stdout.write(await res.text());
  console.error('\n[done]');
} catch (err) {
  console.error('[error]', err.cause?.code ?? err.code, '-', err.message);
  process.exit(1);
}
