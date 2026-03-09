// Bootstrap approach — write CA file before TLS is initialized
// NODE_EXTRA_CA_CERTS is read lazily at first TLS use, not at absolute process start.
// Writing the file before any TLS call makes it work.
//
// This approach is useful when you cannot pass ca options to the TLS library directly
// (e.g., a third-party library that ignores per-request TLS options).
// For code you control, prefer undici ProxyAgent with requestTls.ca instead.
//
// Usage:
//   NODE_EXTRA_CA_CERTS=/tmp/proxy-ca.pem \
//   PROXY_CA_PEM="$(cat detected/proxy-ca.pem)" \
//   node client-bootstrap.mjs

import fs from 'node:fs';

// Step 1: write the CA file BEFORE any TLS/HTTPS module is used
const caPem = process.env.PROXY_CA_PEM;
if (!caPem) {
  console.error('[error] PROXY_CA_PEM is not set');
  process.exit(1);
}
const caFile = process.env.NODE_EXTRA_CA_CERTS;
if (!caFile) {
  console.error('[error] NODE_EXTRA_CA_CERTS is not set');
  process.exit(1);
}
fs.writeFileSync(caFile, caPem);

// Step 2: dynamic import — ensures TLS module loads AFTER the file exists
const https = (await import('node:https')).default;
const { HttpsProxyAgent } = await import('https-proxy-agent');

const agent = new HttpsProxyAgent('http://127.0.0.1:8888');

https.get('https://localhost:8443/hello', { agent }, (res) => {
  res.setEncoding('utf8');
  res.on('data', chunk => process.stdout.write(chunk));
  res.on('end', () => console.error('\n[done]'));
}).on('error', err => {
  console.error('[error]', err.message);
  process.exit(1);
});
