// Model 2-fail — Via proxy, no proxy CA (expected failure)
// Connects through mitmproxy but without trusting the proxy CA.
// mitmproxy re-signs the server cert with its own CA, which Node.js does not trust.
// Expected result: certificate verification error.

import { fetch, ProxyAgent, setGlobalDispatcher } from 'undici';

const agent = new ProxyAgent('http://127.0.0.1:8888');
setGlobalDispatcher(agent);

try {
  const res = await fetch('https://localhost:8443/hello');
  process.stdout.write(await res.text());
  console.error('\n[done]');
} catch (err) {
  console.error('[expected error]', err.cause?.code ?? err.code, '-', err.message);
  process.exit(1);
}
