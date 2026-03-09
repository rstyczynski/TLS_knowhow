// Model 3 — @octokit/rest via proxy, proxy CA
// Uses undici ProxyAgent via setGlobalDispatcher.
// Works with @octokit/rest v21+ (native fetch / undici based).
//
// Usage:
//   GITHUB_TOKEN=<token> node client-octokit-proxy.mjs

import { ProxyAgent, setGlobalDispatcher } from 'undici';
import tls from 'node:tls';
import fs from 'node:fs';
import { Octokit } from '@octokit/rest';

const proxyCa = fs.readFileSync('detected/proxy-ca.pem', 'utf8');

const agent = new ProxyAgent({
  uri: 'http://127.0.0.1:8888',
  requestTls: { ca: [...tls.rootCertificates, proxyCa] },
});
setGlobalDispatcher(agent);

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

try {
  const { data } = await octokit.rest.users.getAuthenticated();
  console.log('Authenticated as:', data.login);
} catch (err) {
  console.error('[error]', err.status, '-', err.message);
  process.exit(1);
}
