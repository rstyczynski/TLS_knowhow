# Node.js

Node.js is a special subject of interest in this analysis. The OCI Function use case requires runtime certificate injection via environment variables, but `NODE_EXTRA_CA_CERTS` takes a file path, not PEM content — which is impractical in a serverless environment.

The solution is to use **undici** (`ProxyAgent` / `Agent`) with the CA embedded directly in the agent, set globally via `setGlobalDispatcher`. This applies the CA to all outgoing requests without any file on disk.

## Setup

### Terminal A — TLS server (self-signed)

```bash
openssl s_server -accept 8443 -WWW \
  -cert self-signed/cert.pem \
  -key self-signed/key.pem
```

### Terminal B — Forward proxy (mitmproxy)

```bash
mitmdump --mode regular --listen-host 127.0.0.1 --listen-port 8888 \
  --set ssl_verify_upstream_trusted_ca="$(pwd)/self-signed/cert.pem"
```

Copy proxy CA once after first run:

```bash
mkdir -p detected
cp "$HOME/.mitmproxy/mitmproxy-ca-cert.pem" detected/proxy-ca.pem
```

### Terminal C — run Node.js models

```bash
npm install
```

---

## Model 0 — Direct connection, no CA (expected failure)

Node.js connects directly to the self-signed server without providing any CA. Demonstrates the default rejection behavior.

```text
Node.js  →  https://localhost:8443/hello  ✗
```

```bash
node client-direct-nocert.mjs
# [expected error] DEPTH_ZERO_SELF_SIGNED_CERT - fetch failed
```

---

## Model 1 — Direct connection, self-signed CA

Node.js connects directly to the TLS server, trusting its self-signed certificate via an undici `Agent` with `connect.ca`.

```text
Node.js  →  https://localhost:8443/hello
```

```bash
node client-direct.mjs
```

The CA is set once in the agent and applied globally:

```js
import { fetch, Agent, setGlobalDispatcher } from 'undici';
import tls from 'node:tls';

const agent = new Agent({
  connect: { ca: [...tls.rootCertificates, selfSignedCa] },
});
setGlobalDispatcher(agent);

const res = await fetch('https://localhost:8443/hello');
```

---

## Model 1b — Via proxy, no proxy CA (expected failure)

Node.js connects through mitmproxy without trusting the proxy CA. The proxy re-signs the server certificate with its own CA, which Node.js rejects.

```text
Node.js  →  mitmproxy :8888  →  https://localhost:8443/hello  ✗
```

```bash
node client-proxy-nocert.mjs
# [expected error] UNABLE_TO_VERIFY_LEAF_SIGNATURE - fetch failed
```

---

## Model 2 — Via proxy, proxy CA

Node.js connects through mitmproxy. The proxy intercepts and re-signs the server certificate with its own CA. Node.js must trust the **proxy CA**, not the original self-signed cert.

```text
Node.js  →  mitmproxy :8888  →  https://localhost:8443/hello
```

Uses undici `ProxyAgent`. Unlike `node:https`, proxy support is built into undici — no extra package needed. The CA for the inner tunneled TLS goes in `requestTls`, not `connect`:

```js
import { fetch, ProxyAgent, setGlobalDispatcher } from 'undici';
import tls from 'node:tls';

const agent = new ProxyAgent({
  uri: 'http://127.0.0.1:8888',
  requestTls: { ca: [...tls.rootCertificates, proxyCa] },
});
setGlobalDispatcher(agent);

const res = await fetch('https://localhost:8443/hello');
```

> **undici `connect` vs `requestTls`**: `connect` applies to the TLS connection to the proxy itself. `requestTls` applies to the inner TLS connection after the HTTP CONNECT tunnel is established. For an HTTP proxy, only `requestTls` matters.

```bash
node client-proxy.mjs
```

---

## Model 2b — Via proxy, proxy CA from environment variable

Same as Model 2 but the CA PEM is supplied as a base64-encoded environment variable instead of a file. Base64 keeps it single-line, safe for `.env` files, OCI Function config, and CI secrets.

```bash
PROXY_CA_B64=$(base64 -i detected/proxy-ca.pem) node client-proxy-env.mjs
```

Inside the code, base64 is decoded back to PEM at runtime — no file on disk needed:

```js
const proxyCa = Buffer.from(process.env.PROXY_CA_B64, 'base64').toString('utf8');
```

---

## Model 3 — @octokit/rest via proxy, proxy CA

`@octokit/rest` v21+ uses native `fetch` (undici-based). Setting the global dispatcher via `setGlobalDispatcher` is sufficient — no custom fetch wrapper needed.

```text
Octokit  →  mitmproxy :8888  →  https://api.github.com
```

```js
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const agent = new ProxyAgent({
  uri: 'http://127.0.0.1:8888',
  requestTls: { ca: [...tls.rootCertificates, proxyCa] },
});
setGlobalDispatcher(agent);

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
```

```bash
export GITHUB_TOKEN=__PUT_YOUR_TOKEN_HERE__
node client-octokit-proxy.mjs
```

---

## NODE_EXTRA_CA_CERTS via Dockerfile

The cleanest container-level approach: bake the certificate into the image and set `NODE_EXTRA_CA_CERTS` in the `Dockerfile`. The application needs no CA handling code at all.

`client-node-extra-ca.mjs` uses plain `fetch()` with no explicit `ca` option — the certificate is picked up automatically from `NODE_EXTRA_CA_CERTS`:

```bash
# local test (no Docker)
NODE_EXTRA_CA_CERTS=self-signed/cert.pem node client-node-extra-ca.mjs
```

```bash
# build and run in Docker (TLS server must be running on host)
docker build -f Dockerfile.node -t ssl-node-demo .

# Linux — host.docker.internal must be added explicitly
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e TLS_HOST=host.docker.internal ssl-node-demo
```

`Dockerfile.node`:

```dockerfile
FROM node:24-slim

# Install distro CA bundle so Node's system store is populated
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY self-signed/cert.pem /etc/ssl/certs/extra-ca.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/extra-ca.pem

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

CMD ["node", "--use-system-ca", "client-node-extra-ca.mjs"]
```

### Bundled vs system CA stores

Node keeps two distinct trust stores:

- **Bundled store**: Mozilla/NSS-style roots that ship with Node itself (`tls.rootCertificates` or `tls.getCACertificates('bundled')`). This is what plain `fetch` / `https` uses by default.
- **System store**: OS or distro store (`tls.getCACertificates('system')`), only used when you opt in (e.g. `node --use-system-ca`).

`node-diff-ca.js` compares those two stores by fingerprint and prints:

- **Only in bundled**
- **Only in system**
- **In both**

Run it on the host:

```bash
node node-diff-ca.js
```

And inside the Docker image:

```bash
docker build -f Dockerfile.node -t ssl-node .
docker run --rm ssl-node node node-diff-ca.js
```

On `node:24-slim` **before** installing `ca-certificates`, the system store in the container contained only `CN=localhost`, so `inBoth` was `0`. **After** adding `ca-certificates` (as in `Dockerfile.node` above), the container reported something like:

```text
Summary: bundled=144 system=143 | onlyBundled=22 onlySystem=21 inBoth=122
```

This makes the difference between **Node’s bundled CAs** and the **OS/distro store** visible and reproducible in a few commands.

---

## NODE_EXTRA_CA_CERTS bootstrap (alternative)

`NODE_EXTRA_CA_CERTS` works for both `node:https` and undici — both use `node:tls` under the hood, which reads this variable and injects the extra CA into OpenSSL's `X509_STORE`. However, it only takes effect when no explicit `ca` option is set; setting `connect.ca` or `requestTls.ca` overrides it completely.

**The catch**: the variable takes a file path, not PEM content. When PEM is available only as an environment variable (e.g. OCI Function config), the file must be written at runtime before the first TLS call.

The bootstrap trick exploits the fact that `NODE_EXTRA_CA_CERTS` is read lazily at first TLS use, not at absolute process start. Writing the file before any TLS call — and using dynamic `import()` to ensure no TLS module loads earlier — makes it work.

The bootstrap is useful when you cannot pass `ca` options to the TLS library (e.g. a third-party library that ignores them). For code you control, `requestTls.ca` with undici is always the cleaner choice.

```bash
NODE_EXTRA_CA_CERTS=/tmp/proxy-ca.pem \
PROXY_CA_PEM="$(cat detected/proxy-ca.pem)" \
node client-bootstrap.mjs
```

`client-bootstrap.mjs` writes the file before any TLS call:

```js
import fs from 'node:fs';
fs.writeFileSync(process.env.NODE_EXTRA_CA_CERTS, process.env.PROXY_CA_PEM);

// dynamic import ensures TLS is not yet initialized
const https = (await import('node:https')).default;
const { HttpsProxyAgent } = await import('https-proxy-agent');
// ... make requests
```

**Limitation**: any static `import` that triggers a TLS connection before your code runs will bypass the bootstrap. Use dynamic `import()` for safety.
