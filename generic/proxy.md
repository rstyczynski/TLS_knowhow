
1. Start your TLS server from `README.md` (if not already running)

```
# terminal A
openssl s_server -accept 8443 -WWW \
  -cert self-signed/cert.pem \
  -key self-signed/key.pem
```

2. Start forward proxy for `HTTPS_PROXY` env

```
brew install mitmproxy
# terminal B
mitmdump --mode regular --listen-host 127.0.0.1 --listen-port 8888 \
  --set ssl_verify_upstream_trusted_ca="$(pwd)/self-signed/cert.pem"
```

3. Use the proxy with curl:

```
export HTTPS_PROXY=http://127.0.0.1:8888
export CURL_CA_BUNDLE="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"
curl https://localhost:8443/hello
```

Note: the env var is `HTTPS_PROXY` (not `HTTS_PROXY`).

4. Stop proxy / disable proxy for shell:

```
pkill -f "mitmdump --mode regular --listen-host 127.0.0.1 --listen-port 8888"
unset HTTPS_PROXY
unset CURL_CA_BUNDLE
```

5. Use mitmproxy CA certificate (correct way)

```
mkdir -p detected
cp "$HOME/.mitmproxy/mitmproxy-ca-cert.pem" detected/proxy-ca.pem
```

```
export CURL_CA_BUNDLE=detected/proxy-ca.pem
curl https://localhost:8443/hello
```
