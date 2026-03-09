// Model 2 — HTTPS via proxy, proxy CA
// Connects to https://localhost:8443/hello through mitmproxy on :8888.
// mitmproxy intercepts and re-signs the server cert with its own CA,
// so Node.js must trust the proxy CA, not the original self-signed cert.
// With undici ProxyAgent, requestTls applies to the inner tunneled TLS — no per-request split.

import { fetch, ProxyAgent, setGlobalDispatcher } from 'undici';
import tls from 'node:tls';
import fs from 'node:fs';

const proxyCa = fs.readFileSync('detected/proxy-ca.pem', 'utf8');

const agent = new ProxyAgent({
  uri: 'http://127.0.0.1:8888',
  requestTls: { ca: [...tls.rootCertificates, proxyCa] },
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
