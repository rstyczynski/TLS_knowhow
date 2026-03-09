// Model 0 — Direct connection, no CA provided
// Connects to https://localhost:8443/hello without trusting the self-signed cert.
// Expected result: certificate verification error.

import { fetch } from 'undici';

try {
  const res = await fetch('https://localhost:8443/hello');
  process.stdout.write(await res.text());
  console.error('\n[done]');
} catch (err) {
  console.error('[expected error]', err.cause?.code ?? err.code, '-', err.message);
  process.exit(1);
}
