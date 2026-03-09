# TLS Know-how

Practical TLS/SSL certificate scenarios demonstrated with openssl and curl. All scenarios aim to describe the SSL/TLS certificate domain and help understand the complexity of CA management in an enterprise. Presented scenarios aim to describe SSL/TLS certificate domain with goal to understand complexity of CA management in an enterprise.

## Self-signed Certificate scenarios

Covers self-signed certificates and certificate chain models. See [docs/GENERIC.md](docs/GENERIC.md).

1. [Scenario 1 — Self-signed standalone certificate](docs/GENERIC.md#scenario-1--self-signed-standalone-certificate)
2. [Scenario 2 — Self-signed CA, CA-signed leaf](docs/GENERIC.md#scenario-2--self-signed-ca-ca-signed-leaf)
3. [Scenario 3 — Self-signed chain (Root → Intermediate → Server)](docs/GENERIC.md#scenario-3--self-signed-chain-root--intermediate--server)

## Self-signed Certificate HTTPS Proxy scenarios

Another bunch of scenarios describes dealing with HTTPS proxy server. See [docs/PROXY.md](docs/PROXY.md).

1. [Scenario 1 — Auto-generated CA certificate](docs/PROXY.md#scenario-1--auto-generated-ca-certificate-mitmproxy-default)
2. [Scenario 2 — Self-signed CA certificate](docs/PROXY.md#scenario-2--self-signed-ca-certificate)
3. [Scenario 3 — CA certificate signed by Root CA](docs/PROXY.md#scenario-3--ca-certificate-signed-by-root-ca)
4. [Scenario 4 — CA certificate signed by Intermediate, signed by Root CA](docs/PROXY.md#scenario-4--ca-certificate-signed-by-intermediate-signed-by-root-ca)
5. [Linux Client with System Trust Store (podman)](docs/PROXY.md#linux-client-with-system-trust-store-podman)

## Certificate Authority Management

Enterprise-level analysis of internal CA certificate distribution, runtime injection, and certificate hygiene. See [docs/MANAGE_CA.md](docs/MANAGE_CA.md).
