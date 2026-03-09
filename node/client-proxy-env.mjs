// Model 2b — HTTPS via proxy, proxy CA from environment variable
// CA PEM is passed as base64 in PROXY_CA_B64 — single-line, safe for env vars.
//
// Usage:
//   PROXY_CA_B64=$(base64 -i detected/proxy-ca.pem) node client-proxy-env.mjs

import { fetch, ProxyAgent, setGlobalDispatcher } from 'undici';
import tls from 'node:tls';

const proxyCaB64 = process.env.PROXY_CA_B64;
if (!proxyCaB64) {
  console.error('[error] PROXY_CA_B64 is not set');
  process.exit(1);
}

const proxyCa = Buffer.from(proxyCaB64, 'base64').toString('utf8');

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
