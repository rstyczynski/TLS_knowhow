# Self-signed Certificate Scenarios

Three certificate chain models demonstrated with openssl and curl. All commands run from the repo root.

1. [Scenario 1 — Self-signed standalone certificate](#scenario-1--self-signed-standalone-certificate)
2. [Scenario 2 — Self-signed CA, CA-signed leaf](#scenario-2--self-signed-ca-ca-signed-leaf)
3. [Scenario 3 — Self-signed chain (Root → Intermediate → Server)](#scenario-3--self-signed-chain-root--intermediate--server)

---

## Scenario 1 — Self-signed standalone certificate

Step 1 — Generate a self-signed, standalone certificate

```bash
mkdir -p cert/{self-signed,detected}

openssl req -x509 -newkey rsa:2048 \
  -keyout cert/self-signed/key.pem -out cert/self-signed/cert.pem \
  -days 365 -nodes \
  -subj "/CN=localhost/emailAddress=admin@example.com" \
  -addext "subjectAltName=DNS:localhost,DNS:host.docker.internal"

openssl x509 -in cert/self-signed/cert.pem -noout -subject -ext subjectAltName
```

Step 2 — Start the TLS service

```bash
echo "I'm here caged by SSL! Help me please!" > hello
openssl s_server -accept 8443 -WWW \
  -cert cert/self-signed/cert.pem \
  -key cert/self-signed/key.pem
```

Step 3 - Connect to server

```bash
curl https://localhost:8443/hello
```

(On first run this may fail with "certificate verify failed" until you use Step 4 to get the cert or register the CA.)

Step 4 - Discover CA certs from the service endpoint and connect using them

```bash
openssl s_client -connect localhost:8443 -showcerts </dev/null \
  | sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/p' > cert/detected/ca-chain.pem

curl https://localhost:8443/hello \
  --cacert cert/detected/ca-chain.pem
```

Step 5 - Discover public key from the service endpoint's CA certificate

```bash
openssl s_client -connect localhost:8443 -showcerts </dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | openssl base64 > cert/detected/pub.pem

curl https://localhost:8443/hello \
  --cacert cert/detected/ca-chain.pem \
  --pinnedpubkey "sha256//$(cat cert/detected/pub.pem)"
```

Step 7 - Use ENV to provide CA

```bash
CURL_CA_BUNDLE="$(pwd)/cert/detected/ca-chain.pem" \
curl https://localhost:8443/hello
```

---

## Scenario 2 — Self-signed CA, CA-signed leaf

This section creates a simple 2-level chain: a self-signed Root CA signs the server (leaf) certificate. All commands run from the repo root; artifacts live under `cert/ca-leaf/`.

Step 1 — Create folders

```bash
mkdir -p cert/ca-leaf/{root,server,detected}
```

Step 2 — Create self-signed Root CA

```bash
openssl genrsa -out cert/ca-leaf/root/root.key.pem 4096
openssl req -x509 -new -key cert/ca-leaf/root/root.key.pem -sha256 -days 3650 \
  -out cert/ca-leaf/root/root.cert.pem \
  -subj "/CN=Local Root CA/emailAddress=ca-admin@example.com" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash"
```

Step 3 — Create server key and CSR

```bash
openssl genrsa -out cert/ca-leaf/server/key.pem 2048
openssl req -new -key cert/ca-leaf/server/key.pem \
  -out cert/ca-leaf/server/server.csr.pem \
  -subj "/CN=localhost/emailAddress=admin@example.com"
```

Step 4 — Sign server cert with Root CA

```bash
openssl x509 -req -in cert/ca-leaf/server/server.csr.pem \
  -CA cert/ca-leaf/root/root.cert.pem \
  -CAkey cert/ca-leaf/root/root.key.pem -CAcreateserial \
  -out cert/ca-leaf/server/cert.pem -days 365 -sha256 \
  -extfile <(cat <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,DNS:host.docker.internal
authorityKeyIdentifier=keyid,issuer
subjectKeyIdentifier=hash
EOF
)
```

Step 5 — Verify: Root CA signed the server cert

```bash
openssl verify -CAfile cert/ca-leaf/root/root.cert.pem cert/ca-leaf/server/cert.pem
```

Expected: `cert/ca-leaf/server/cert.pem: OK`

Step 6 — Start TLS server with the server cert

```bash
echo "I'm here caged by SSL! Help me please!" > hello
openssl s_server -accept 8443 -WWW \
  -cert cert/ca-leaf/server/cert.pem \
  -key cert/ca-leaf/server/key.pem
```

Step 7 — Detect chain from endpoint

```bash
openssl s_client -connect localhost:8443 -showcerts </dev/null 2>/dev/null \
  | sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/p' > cert/ca-leaf/detected/ca-chain.pem
```

Step 8 — Connect with curl trusting the Root CA

```bash
curl --cacert cert/ca-leaf/root/root.cert.pem https://localhost:8443/hello
```

Expected: success; the server cert chains to the trusted Root CA.

Conclusion: A self-signed Root CA can sign server certificates. Trusting the Root CA validates all certificates it has signed — the client only needs the Root CA cert, not the server cert itself.

Step 9 — Look inside detected chain

```bash
decode_cert_file() {
  local f="$1"
  echo "=== $f"
  awk 'BEGIN{n=0} /BEGIN CERTIFICATE/{n++; out="/tmp/cert-" n ".pem"} {if(n>0) print > out} END{print "cert_count=" n}' "$f"
  for c in /tmp/cert-*.pem; do
    openssl x509 -in "$c" -noout -subject -issuer
  done
  rm -f /tmp/cert-*.pem
}

decode_cert_file cert/ca-leaf/detected/ca-chain.pem
```

Expected: 1 certificate — the server leaf cert (`CN=localhost`, issued by `CN=Local Root CA`). The Root CA itself is not sent by the server; the client must supply it separately via `--cacert`.

---

## Scenario 3 — Self-signed chain (Root → Intermediate → Server)

This models a realistic certificate chain locally:
- Root CA: self-signed
- Intermediate CA: signed by Root
- Server cert (`localhost`): signed by Intermediate

All commands are run from the repo root; chain artifacts live under `cert/inter/` (same layout as `cert/self-signed` and `cert/detected` in the first section).

Step 1 — Create folders

```bash
mkdir -p cert/inter/{root,intermediate,server,detected,bundle}
```

Step 2 — Create Root CA (self-signed)

```bash
openssl genrsa -out cert/inter/root/root.key.pem 4096
openssl req -x509 -new -key cert/inter/root/root.key.pem -sha256 -days 3650 \
  -out cert/inter/root/root.cert.pem \
  -subj "/CN=Local Root CA/emailAddress=ca-admin@example.com" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash"
```

Step 3 — Create Intermediate CA (signed by Root)

```bash
openssl genrsa -out cert/inter/intermediate/intermediate.key.pem 4096
openssl req -new -key cert/inter/intermediate/intermediate.key.pem \
  -out cert/inter/intermediate/intermediate.csr.pem \
  -subj "/CN=Local Intermediate CA/emailAddress=intermediate-admin@example.com"

openssl x509 -req -in cert/inter/intermediate/intermediate.csr.pem \
  -CA cert/inter/root/root.cert.pem -CAkey cert/inter/root/root.key.pem -CAcreateserial \
  -out cert/inter/intermediate/intermediate.cert.pem -days 1825 -sha256 \
  -extfile <(cat <<'EOF'
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
authorityKeyIdentifier=keyid,issuer
subjectKeyIdentifier=hash
EOF
)
```

Step 4 — Create Server cert for localhost (signed by Intermediate, with SAN)

```bash
openssl genrsa -out cert/inter/server/server.key.pem 2048
openssl req -new -key cert/inter/server/server.key.pem \
  -out cert/inter/server/server.csr.pem \
  -subj "/CN=localhost/emailAddress=admin@example.com"

openssl x509 -req -in cert/inter/server/server.csr.pem \
  -CA cert/inter/intermediate/intermediate.cert.pem \
  -CAkey cert/inter/intermediate/intermediate.key.pem -CAcreateserial \
  -out cert/inter/server/server.cert.pem -days 825 -sha256 \
  -extfile <(cat <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost
authorityKeyIdentifier=keyid,issuer
subjectKeyIdentifier=hash
EOF
)
```

Step 5 — Build chain files

```bash
# what server sends (leaf + intermediate)
cat cert/inter/server/server.cert.pem cert/inter/intermediate/intermediate.cert.pem > cert/inter/server/server.chain.pem
```

Step 6 — Start TLS server with chain

```bash
echo "I'm here caged by SSL! Help me please!" > hello
openssl s_server -accept 8443 -WWW \
  -cert cert/inter/server/server.cert.pem \
  -cert_chain cert/inter/intermediate/intermediate.cert.pem \
  -key cert/inter/server/server.key.pem
```

Step 7 — Detect CA chain from the running endpoint

```bash
openssl s_client -connect localhost:8443 -showcerts </dev/null 2>/dev/null \
  | sed -n '/BEGIN CERTIFICATE/,/END CERTIFICATE/p' > cert/inter/detected/ca-chain.pem
```

Step 8 — Test with curl using detected CA chain

```bash
curl --cacert cert/inter/detected/ca-chain.pem https://localhost:8443/hello
```

Step 9 — Build CA bundle

```bash
cat cert/inter/root/root.cert.pem cert/inter/intermediate/intermediate.cert.pem > cert/inter/bundle/ca-bundle.pem
```

Step 10 — Verify chain

```bash
openssl x509 -in cert/inter/server/server.cert.pem -noout -subject -issuer -ext subjectAltName
openssl verify -CAfile cert/inter/bundle/ca-bundle.pem cert/inter/server/server.cert.pem
```

Expected: `cert/inter/server/server.cert.pem: OK`

Step 11 — Inspect cert files

```bash
decode_cert_file() {
  local f="$1"
  echo "=== $f"
  awk 'BEGIN{n=0} /BEGIN CERTIFICATE/{n++; out="/tmp/cert-" n ".pem"} {if(n>0) print > out} END{print "cert_count=" n}' "$f"
  for c in /tmp/cert-*.pem; do
    openssl x509 -in "$c" -noout -subject -issuer
  done
  rm -f /tmp/cert-*.pem
}

decode_cert_file cert/inter/detected/ca-chain.pem
decode_cert_file cert/inter/bundle/ca-bundle.pem
```

Expected:

- `cert/inter/detected/ca-chain.pem` — 2 certs: leaf (`CN=localhost`) and intermediate (`CN=Local Intermediate CA`). Root is not sent by the server.
- `cert/inter/bundle/ca-bundle.pem` — 2 certs: Root CA and Intermediate CA.

Conclusion: The server sends the leaf cert and intermediate cert in the TLS handshake; the root CA is not transmitted and must be provided separately as a trust anchor. The CA bundle (root + intermediate) is sufficient to verify the full chain.
