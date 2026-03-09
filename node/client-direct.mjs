// Model 1 — Direct HTTPS connection, self-signed CA
// Connects to https://localhost:8443/hello without going through a proxy.
// The self-signed cert is trusted explicitly via Agent connect options.

import { fetch, Agent, setGlobalDispatcher } from 'undici';
import tls from 'node:tls';
import fs from 'node:fs';

const selfSignedCa = fs.readFileSync('self-signed/cert.pem', 'utf8');

const agent = new Agent({
  connect: { ca: [...tls.rootCertificates, selfSignedCa] },
});
setGlobalDispatcher(agent);

try {
  const res = await fetch('https://localhost:8443/hello');
  process.stdout.write(await res.text());
  console.error('\n[done]');
} catch (err) {
  console.error('[error]', err.message);
  process.exit(1);
}
