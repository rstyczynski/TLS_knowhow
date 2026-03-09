# Self-signed Certificate HTTPS Proxy Scenarios

Demonstrates four ways to configure mitmproxy's signing certificate, and the corresponding client trust bundles required.

1. [Scenario 1 — Auto-generated CA certificate (mitmproxy default)](#scenario-1--auto-generated-ca-certificate-mitmproxy-default)
2. [Scenario 2 — Self-signed CA certificate](#scenario-2--self-signed-ca-certificate)
3. [Scenario 3 — CA certificate signed by Root CA](#scenario-3--ca-certificate-signed-by-root-ca)
4. [Scenario 4 — CA certificate signed by Intermediate, signed by Root CA](#scenario-4--ca-certificate-signed-by-intermediate-signed-by-root-ca)
5. [Linux Client with System Trust Store (podman)](#linux-client-with-system-trust-store-podman)
6. [Summary](#summary)

---

**Why the proxy needs a CA certificate, not a leaf certificate:**
A regular server holds a leaf certificate (CA:FALSE) that proves its own identity. POroxy server works differently — it must dynamically generate and sign a fake certificate for *each* intercepted hostname (e.g. `github.com`, `localhost`) on the fly. Signing certificates is a CA operation, so proxy server must be given a CA certificate (CA:TRUE, with `keyCertSign` usage). The scenarios below differ only in *how that CA certificate is obtained and who signed it*.

All scenarios use the TLS server from the [Scenario 3 — Self-signed chain](GENERIC.md#scenario-3--self-signed-chain-root--intermediate--server) section.

Start it first (terminal A):

```bash
echo "I'm here caged by SSL! Help me please!" > hello
openssl s_server -accept 8443 -WWW \
  -cert cert/inter/server/server.cert.pem \
  -cert_chain cert/inter/intermediate/intermediate.cert.pem \
  -key cert/inter/server/server.key.pem
```

Install mitmproxy if needed:

```bash
# osx version, use your OS command to install
brew install mitmproxy
```

The upstream CA bundle used by the proxy to verify the server is always `cert/inter/bundle/ca-bundle.pem` (built in the Self-signed chain model section).

---

## Scenario 1 — Auto-generated CA certificate (mitmproxy default)

mitmproxy generates its own CA on first run and stores it in `~/.mitmproxy/`. The client must trust this auto-generated CA cert.

Step 1 — Start proxy (terminal B)

```bash
mitmdump --mode regular --listen-host 127.0.0.1 --listen-port 8888 \
  --set ssl_verify_upstream_trusted_ca="$(pwd)/cert/inter/bundle/ca-bundle.pem"
```

Step 2 — Connect via proxy

Client trust bundle: mitmproxy's own auto-generated CA cert.

```bash
export HTTPS_PROXY=http://127.0.0.1:8888
curl --cacert "$HOME/.mitmproxy/mitmproxy-ca-cert.pem" https://localhost:8443/hello
```

Expected: success — curl trusts the auto-generated mitmproxy CA.

---

## Scenario 2 — Self-signed CA certificate

A standalone self-signed CA cert is generated for the proxy. The client trusts it directly as a trust anchor.

Step 1 — Generate self-signed proxy CA

```bash
mkdir -p cert/proxy/self-signed

openssl req -x509 -newkey rsa:2048 \
  -keyout cert/proxy/self-signed/proxy.key.pem \
  -out cert/proxy/self-signed/proxy.cert.pem \
  -days 365 -nodes \
  -subj "/CN=Local Proxy CA/emailAddress=proxy-admin@example.com" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash"
```

Step 2 — Start proxy (terminal B)

```bash
mkdir -p /tmp/mitmproxy-self-signed
cat cert/proxy/self-signed/proxy.key.pem cert/proxy/self-signed/proxy.cert.pem \
  > /tmp/mitmproxy-self-signed/mitmproxy-ca.pem

mitmdump --mode regular --listen-host 127.0.0.1 --listen-port 8888 \
  --set confdir=/tmp/mitmproxy-self-signed \
  --set ssl_verify_upstream_trusted_ca="$(pwd)/cert/inter/bundle/ca-bundle.pem"
```

Step 3 — Connect via proxy

Client trust bundle: the self-signed proxy cert (it is its own trust anchor).

```bash
export HTTPS_PROXY=http://127.0.0.1:8888
curl --cacert cert/proxy/self-signed/proxy.cert.pem https://localhost:8443/hello
```

Expected: success — curl trusts the self-signed proxy CA directly.

---

## Scenario 3 — CA certificate signed by Root CA

The proxy CA is signed by the Root CA from `cert/inter/`. The client trust bundle must include both Root CA and Proxy CA so curl can verify the chain.

Step 1 — Generate proxy CA signed by Root CA

```bash
mkdir -p cert/proxy/ca-signed

openssl genrsa -out cert/proxy/ca-signed/proxy.key.pem 2048
openssl req -new -key cert/proxy/ca-signed/proxy.key.pem \
  -out cert/proxy/ca-signed/proxy.csr.pem \
  -subj "/CN=Local Proxy CA/emailAddress=proxy-admin@example.com"

openssl x509 -req -in cert/proxy/ca-signed/proxy.csr.pem \
  -CA cert/inter/root/root.cert.pem \
  -CAkey cert/inter/root/root.key.pem -CAcreateserial \
  -out cert/proxy/ca-signed/proxy.cert.pem -days 365 -sha256 \
  -extfile <(cat <<'EOF'
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
authorityKeyIdentifier=keyid,issuer
subjectKeyIdentifier=hash
EOF
)
```

Verify:

```bash
openssl verify -CAfile cert/inter/root/root.cert.pem cert/proxy/ca-signed/proxy.cert.pem
```

Step 2 — Build client trust bundle

```bash
cat cert/inter/root/root.cert.pem cert/proxy/ca-signed/proxy.cert.pem \
  > cert/proxy/ca-signed/client-trust.pem
```

Step 3 — Start proxy (terminal B)

```bash
mkdir -p /tmp/mitmproxy-ca-signed
cat cert/proxy/ca-signed/proxy.key.pem cert/proxy/ca-signed/proxy.cert.pem \
  > /tmp/mitmproxy-ca-signed/mitmproxy-ca.pem

mitmdump --mode regular --listen-host 127.0.0.1 --listen-port 8888 \
  --set confdir=/tmp/mitmproxy-ca-signed \
  --set ssl_verify_upstream_trusted_ca="$(pwd)/cert/inter/bundle/ca-bundle.pem"
```

Step 4 — Connect via proxy

```bash
export HTTPS_PROXY=http://127.0.0.1:8888
curl --cacert cert/proxy/ca-signed/client-trust.pem https://localhost:8443/hello
```

Expected: success. Chain: intercepted cert → Proxy CA → Root CA (both in client-trust.pem).

---

## Scenario 4 — CA certificate signed by Intermediate, signed by Root CA

Three-level proxy PKI: Root CA → Intermediate CA → Proxy CA. Uses a dedicated PKI under `cert/proxy/inter-signed/` with `pathlen` values set to permit the full depth.

Step 1 — Create Root CA (pathlen:2)

```bash
mkdir -p cert/proxy/inter-signed/{root,inter,proxy}

openssl genrsa -out cert/proxy/inter-signed/root/root.key.pem 4096
openssl req -x509 -new -key cert/proxy/inter-signed/root/root.key.pem -sha256 -days 3650 \
  -out cert/proxy/inter-signed/root/root.cert.pem \
  -subj "/CN=Proxy Root CA/emailAddress=proxy-root@example.com" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:2" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash"
```

Step 2 — Create Intermediate CA (pathlen:1)

```bash
openssl genrsa -out cert/proxy/inter-signed/inter/inter.key.pem 4096
openssl req -new -key cert/proxy/inter-signed/inter/inter.key.pem \
  -out cert/proxy/inter-signed/inter/inter.csr.pem \
  -subj "/CN=Proxy Intermediate CA/emailAddress=proxy-inter@example.com"

openssl x509 -req -in cert/proxy/inter-signed/inter/inter.csr.pem \
  -CA cert/proxy/inter-signed/root/root.cert.pem \
  -CAkey cert/proxy/inter-signed/root/root.key.pem -CAcreateserial \
  -out cert/proxy/inter-signed/inter/inter.cert.pem -days 1825 -sha256 \
  -extfile <(cat <<'EOF'
basicConstraints=critical,CA:TRUE,pathlen:1
keyUsage=critical,keyCertSign,cRLSign
authorityKeyIdentifier=keyid,issuer
subjectKeyIdentifier=hash
EOF
)
```

Step 3 — Create Proxy CA (pathlen:0, signed by Intermediate)

```bash
openssl genrsa -out cert/proxy/inter-signed/proxy/proxy.key.pem 2048
openssl req -new -key cert/proxy/inter-signed/proxy/proxy.key.pem \
  -out cert/proxy/inter-signed/proxy/proxy.csr.pem \
  -subj "/CN=Proxy CA/emailAddress=proxy-ca@example.com"

openssl x509 -req -in cert/proxy/inter-signed/proxy/proxy.csr.pem \
  -CA cert/proxy/inter-signed/inter/inter.cert.pem \
  -CAkey cert/proxy/inter-signed/inter/inter.key.pem -CAcreateserial \
  -out cert/proxy/inter-signed/proxy/proxy.cert.pem -days 365 -sha256 \
  -extfile <(cat <<'EOF'
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
authorityKeyIdentifier=keyid,issuer
subjectKeyIdentifier=hash
EOF
)
```

Verify full chain:

```bash
openssl verify \
  -CAfile cert/proxy/inter-signed/root/root.cert.pem \
  -untrusted cert/proxy/inter-signed/inter/inter.cert.pem \
  cert/proxy/inter-signed/proxy/proxy.cert.pem
```

Step 4 — Build client trust bundle

All three CA certs are needed so curl can verify the full chain.

```bash
cat cert/proxy/inter-signed/root/root.cert.pem \
    cert/proxy/inter-signed/inter/inter.cert.pem \
    cert/proxy/inter-signed/proxy/proxy.cert.pem \
  > cert/proxy/inter-signed/client-trust.pem
```

Step 5 — Start proxy (terminal B)

```bash
mkdir -p /tmp/mitmproxy-inter-signed
cat cert/proxy/inter-signed/proxy/proxy.key.pem \
    cert/proxy/inter-signed/proxy/proxy.cert.pem \
  > /tmp/mitmproxy-inter-signed/mitmproxy-ca.pem

mitmdump --mode regular --listen-host 127.0.0.1 --listen-port 8888 \
  --set confdir=/tmp/mitmproxy-inter-signed \
  --set ssl_verify_upstream_trusted_ca="$(pwd)/cert/inter/bundle/ca-bundle.pem"
```

Step 6 — Connect via proxy

```bash
export HTTPS_PROXY=http://127.0.0.1:8888
curl --cacert cert/proxy/inter-signed/client-trust.pem https://localhost:8443/hello
```

Expected: success. Chain: intercepted cert → Proxy CA → Proxy Intermediate → Proxy Root CA (all in client-trust.pem).

---

## Linux Client with System Trust Store (podman)

Scenarios 1–4 use `--cacert` to pass CA certificates explicitly. In a real Linux environment, CA certificates are registered in the OS trust store so all applications trust them without per-command flags.

This chapter reuses the server and proxy from **Scenario 3** (proxy CA signed by Root CA) and runs `curl` inside a RHEL UBI9 podman container where both the Root CA and Proxy CA are added to the system trust store.

### Step 1 — Start TLS server (terminal A, host)

```bash
echo "I'm here caged by SSL! Help me please!" > hello
openssl s_server -accept 8443 -WWW \
  -cert cert/inter/server/server.cert.pem \
  -cert_chain cert/inter/intermediate/intermediate.cert.pem \
  -key cert/inter/server/server.key.pem
```

### Step 2 — Generate proxy CA signed by Root CA (host, once)

Skip if `cert/proxy/ca-signed/proxy.cert.pem` already exists from Scenario 3.

```bash
mkdir -p cert/proxy/ca-signed

openssl genrsa -out cert/proxy/ca-signed/proxy.key.pem 2048
openssl req -new -key cert/proxy/ca-signed/proxy.key.pem \
  -out cert/proxy/ca-signed/proxy.csr.pem \
  -subj "/CN=Local Proxy CA/emailAddress=proxy-admin@example.com"

openssl x509 -req -in cert/proxy/ca-signed/proxy.csr.pem \
  -CA cert/inter/root/root.cert.pem \
  -CAkey cert/inter/root/root.key.pem -CAcreateserial \
  -out cert/proxy/ca-signed/proxy.cert.pem -days 365 -sha256 \
  -extfile <(cat <<'EOF'
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
authorityKeyIdentifier=keyid,issuer
subjectKeyIdentifier=hash
EOF
)
```

### Step 3 — Start proxy (terminal B, host)

The proxy must listen on all interfaces (`0.0.0.0`) so it is reachable from the podman VM network:

```bash
mkdir -p /tmp/mitmproxy-ca-signed
cat cert/proxy/ca-signed/proxy.key.pem cert/proxy/ca-signed/proxy.cert.pem \
  > /tmp/mitmproxy-ca-signed/mitmproxy-ca.pem

mitmdump --mode regular --listen-host 0.0.0.0 --listen-port 8888 \
  --set confdir=/tmp/mitmproxy-ca-signed \
  --set ssl_verify_upstream_trusted_ca="$(pwd)/cert/inter/bundle/ca-bundle.pem"
```

### Step 4 — Start Linux client container

On macOS, podman runs containers inside a Linux VM — `127.0.0.1` inside the container is the VM's loopback, not the Mac's. Use `host.containers.internal` to reach services on the Mac host instead.

```bash
podman run -it --rm \
  -v "$(pwd):/ssl:ro" \
  registry.access.redhat.com/ubi9/ubi bash
```

### Step 5 — Add Root CA and Proxy CA to system trust store (inside container)

```bash
cp /ssl/cert/inter/root/root.cert.pem \
   /etc/pki/ca-trust/source/anchors/local-root-ca.pem

cp /ssl/cert/proxy/ca-signed/proxy.cert.pem \
   /etc/pki/ca-trust/source/anchors/local-proxy-ca.pem

update-ca-trust
```

### Step 6 — Verify both CAs are trusted (inside container)

```bash
trust list | grep -A2 "Local Root CA\|Local Proxy CA"
```

### Step 7 — Connect via proxy — no --cacert needed (inside container)

`host.containers.internal` resolves to the Mac host from inside the container. curl sends `CONNECT localhost:8443` to the proxy; the proxy (on the Mac) opens the actual connection to `localhost:8443` where the TLS server is running.

```bash
export HTTPS_PROXY=http://host.containers.internal:8888
curl https://localhost:8443/hello
```

Expected: success — curl finds both Root CA and Proxy CA in the system trust store automatically. No `--cacert` flag is needed.

> Trust store changes are discarded automatically when the container exits (`--rm`).

## Summary

| Scenario | CA certificate origin | Client trust bundle |
|----------|-----------------------|---------------------|
| 1 — Auto | mitmproxy auto-generated | `~/.mitmproxy/mitmproxy-ca-cert.pem` |
| 2 — Self-signed | Self-signed (own trust anchor) | the CA cert itself |
| 3 — Root CA-signed | Signed by Root CA | Root CA + proxy CA cert |
| 4 — Intermediate-signed | Signed by Intermediate (signed by Root CA) | Root CA + Intermediate CA + proxy CA cert |
