# Red Hat-style CA trust store in Podman

This creates a RHEL-compatible container and lets you test trust anchors in:
- `/etc/pki/ca-trust/source/anchors/`

Then rebuild trust with:
- `update-ca-trust extract`

## 1) Build image with CA tooling preinstalled

```bash
cat >Dockerfile <<__EOF
FROM registry.access.redhat.com/ubi9/ubi

LABEL org.opencontainers.image.title="rh-ca-lab" \
      org.opencontainers.image.authors="Your Name <you@example.com>" \
      org.opencontainers.image.vendor="Example Org"

RUN dnf -y install ca-certificates openssl curl-minimal \
    && update-ca-trust extract \
    && dnf clean all

WORKDIR /work

CMD ["bash"]
__EOF

podman build -t rh-ca-lab:latest -f Dockerfile .
```

## 2) Start a RHEL-like container shell

```bash
podman run --rm -it \
  -v "$(pwd):/work:Z" \
  --name rh-ca-lab \
  rh-ca-lab:latest bash
```

## 3) Generate your own Root + Intermediate CA + Server (inside container)

```bash
mkdir -p /tmp/pki/{root,intermediate}

CERT_ROOT_EMAIL="root@example.com"
CERT_ROOT_ORG="Root Example Org"
CERT_ROOT_UNIT="Root Security"

openssl genrsa -out /tmp/pki/root/root.key.pem 4096
openssl req -x509 -new -key /tmp/pki/root/root.key.pem -sha256 -days 3650 \
  -out /tmp/pki/root/root.cert.pem \
  -subj "/CN=Container Local Root CA/O=${CERT_ROOT_ORG}/OU=${CERT_ROOT_UNIT}/emailAddress=${CERT_ROOT_EMAIL}" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

CERT_INTER_EMAIL="inter@example.com"
CERT_INTER_ORG="Inter Org"
CERT_INTER_UNIT="Inter Security"

openssl genrsa -out /tmp/pki/intermediate/intermediate.key.pem 4096
openssl req -new -key /tmp/pki/intermediate/intermediate.key.pem \
  -out /tmp/pki/intermediate/intermediate.csr.pem \
  -subj "/CN=Container Local Intermediate CA/O=${CERT_INTER_ORG}/OU=${CERT_INTER_UNIT}/emailAddress=${CERT_INTER_EMAIL}"

openssl x509 -req -in /tmp/pki/intermediate/intermediate.csr.pem \
  -CA /tmp/pki/root/root.cert.pem -CAkey /tmp/pki/root/root.key.pem -CAcreateserial \
  -out /tmp/pki/intermediate/intermediate.cert.pem -days 1825 -sha256 \
  -extfile <(cat <<'EOF'
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
authorityKeyIdentifier=keyid,issuer
subjectKeyIdentifier=hash
EOF
)

CERT_OWNER_EMAIL="owner@example.com"
CERT_OWNER_ORG="Owner Org"
CERT_OWNER_UNIT="Owner Security"

openssl genrsa -out /tmp/pki/server.key.pem 2048
openssl req -new -key /tmp/pki/server.key.pem \
  -out /tmp/pki/server.csr.pem \
  -subj "/CN=localhost/O=${CERT_OWNER_ORG}/OU=${CERT_OWNER_UNIT}/emailAddress=${CERT_OWNER_EMAIL}"

openssl x509 -req -in /tmp/pki/server.csr.pem \
  -CA /tmp/pki/intermediate/intermediate.cert.pem \
  -CAkey /tmp/pki/intermediate/intermediate.key.pem -CAcreateserial \
  -out /tmp/pki/server.cert.pem -days 825 -sha256 \
  -extfile <(cat <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost
authorityKeyIdentifier=keyid,issuer
subjectKeyIdentifier=hash
EOF
)

openssl x509 -in /tmp/pki/root/root.cert.pem -noout -subject -issuer
openssl x509 -in /tmp/pki/intermediate/intermediate.cert.pem -noout -subject -issuer
openssl x509 -in /tmp/pki/server.cert.pem -noout -subject -issuer -ext subjectAltName
```

## 4) Add generated Root CA as trust anchor

In most deployments, only the Root CA certificate is added to the system trust store as an anchor. The Intermediate CA certificate is provided by the server during the TLS handshake, while the Root CA serves as the trusted authority locally.

```bash
cp /tmp/pki/root/root.cert.pem /etc/pki/ca-trust/source/anchors/my-self-signed-root-ca.pem
update-ca-trust extract
```

## 5) Verify anchor is in extracted trust bundle

```bash
verify_subject_in_bundle() {
  local subject_pattern="$1"
  local tmp_prefix="/tmp/rh-ca-$$"
  local bundle_path="/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"

  # Ensure extracted bundle is up to date before checking.
  update-ca-trust extract >/dev/null 2>&1

  awk -v p="$tmp_prefix" 'BEGIN{n=0} /BEGIN CERTIFICATE/{n++} n>0{print > p "-" n ".pem"}' "$bundle_path"
  for c in "$tmp_prefix"-*.pem; do
    cert_subject="$(openssl x509 -in "$c" -noout -subject | sed 's/^subject=//')"
    if printf '%s' "$cert_subject" | grep -q "$subject_pattern"; then
      echo "FOUND subject in trust bundle: $subject_pattern"
      rm -f "$tmp_prefix"-*.pem
      return 0
    fi
  done
  rm -f "$tmp_prefix"-*.pem
  echo "NOT FOUND subject in trust bundle: $subject_pattern"
  return 1
}

# For non-anchor certs, we expect they are NOT in system trust bundle.
verify_subject_not_in_bundle() {
  local subject_pattern="$1"
  local tmp_prefix="/tmp/rh-ca-$$"
  local bundle_path="/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"

  update-ca-trust extract >/dev/null 2>&1

  awk -v p="$tmp_prefix" 'BEGIN{n=0} /BEGIN CERTIFICATE/{n++} n>0{print > p "-" n ".pem"}' "$bundle_path"
  for c in "$tmp_prefix"-*.pem; do
    cert_subject="$(openssl x509 -in "$c" -noout -subject | sed 's/^subject=//')"
    if printf '%s' "$cert_subject" | grep -q "$subject_pattern"; then
      echo "UNEXPECTED subject found in trust bundle: $subject_pattern"
      rm -f "$tmp_prefix"-*.pem
      return 1
    fi
  done
  rm -f "$tmp_prefix"-*.pem
  echo "OK subject not present in trust bundle: $subject_pattern"
  return 0
}

verify_subject_in_bundle "CN=Container Local Root CA.*emailAddress=root@example.com"
verify_subject_not_in_bundle "CN=Container Local Intermediate CA.*emailAddress=inter@example.com"
verify_subject_not_in_bundle "CN=localhost.*emailAddress=owner@example.com"
```

## 6) Remove anchor (cleanup)

```bash
rm -f /etc/pki/ca-trust/source/anchors/my-self-signed-root-ca.pem
update-ca-trust extract
```

## 7) Optional: blocklist/distrust instead of remove

```bash
cp /tmp/pki/root/root.cert.pem /etc/pki/ca-trust/source/blocklist/my-self-signed-root-ca.pem
update-ca-trust extract
```

To undo distrust:

```bash
rm -f /etc/pki/ca-trust/source/blocklist/my-self-signed-root-ca.pem
update-ca-trust extract
```

## 8) Full curl scenario matrix (trust + distrust)

Start a local TLS test service inside the container (signed by your generated chain):

```bash
openssl s_server -accept 9443 -WWW \
  -cert /tmp/pki/server.cert.pem \
  -cert_chain /tmp/pki/intermediate/intermediate.cert.pem \
  -key /tmp/pki/server.key.pem &
S_SERVER_PID=$!
TARGET_URL="https://localhost:9443/hello"
```

Reset to clean state first:

```bash
unset CURL_CA_BUNDLE SSL_CERT_FILE
rm -f /etc/pki/ca-trust/source/anchors/my-self-signed-root-ca.pem
rm -f /etc/pki/ca-trust/source/blocklist/my-self-signed-root-ca.pem
update-ca-trust extract
```

1) No trust material (expected: FAIL)

```bash
curl -sS "$TARGET_URL"
```

2) Explicit CA via CLI (expected: PASS)

```bash
curl -sS --cacert /tmp/pki/root/root.cert.pem "$TARGET_URL"
```

3) Explicit CA via ENV (expected: PASS)

```bash
export CURL_CA_BUNDLE=/tmp/pki/root/root.cert.pem
curl -sS "$TARGET_URL"
unset CURL_CA_BUNDLE
```

4) Trust via system anchor store (expected: PASS)

```bash
cp /tmp/pki/root/root.cert.pem /etc/pki/ca-trust/source/anchors/my-self-signed-root-ca.pem
update-ca-trust extract
curl -sS "$TARGET_URL"
```

5) Blacklist/distrust same CA (expected: FAIL)

```bash
cp /tmp/pki/root/root.cert.pem /etc/pki/ca-trust/source/blocklist/my-self-signed-root-ca.pem
update-ca-trust extract
curl -sS "$TARGET_URL"
```

6) Remove blacklist entry, keep anchor (expected: PASS)

```bash
rm -f /etc/pki/ca-trust/source/blocklist/my-self-signed-root-ca.pem
update-ca-trust extract
curl -sS "$TARGET_URL"
```

7) Remove anchor again (expected: FAIL)

```bash
rm -f /etc/pki/ca-trust/source/anchors/my-self-signed-root-ca.pem
update-ca-trust extract
curl -sS "$TARGET_URL"
```

8) Use only self-signed CA bundle and call GitHub (expected: FAIL)

```bash
export CURL_CA_BUNDLE=/tmp/pki/root/root.cert.pem
curl -sS https://github.com >/dev/null
```

9) Use system extracted CA bundle and call GitHub (expected: PASS)

```bash
cp /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem /tmp/pki/system-ca-bundle.pem
export CURL_CA_BUNDLE=/tmp/pki/system-ca-bundle.pem
curl -sS https://github.com >/dev/null
```

10) With system-only bundle, call local service (expected: FAIL)

```bash
curl -sS "$TARGET_URL"
```

11) Merge system bundle + self-signed root and call both (expected: PASS/PASS)

Having no root access prevents you from installing custom CAs into the system trust bundle, but you can work around this by combining the system bundle with your own CA file in a user-writable location and setting CURL_CA_BUNDLE to this merged bundle.

```bash
cat /tmp/pki/system-ca-bundle.pem /tmp/pki/root/root.cert.pem > /tmp/pki/merged-ca-bundle.pem
export CURL_CA_BUNDLE=/tmp/pki/merged-ca-bundle.pem
curl -sS https://github.com >/dev/null
curl -sS "$TARGET_URL"
unset CURL_CA_BUNDLE
```

12) Inspect certificates used in this scenario: root, intermediate, leaf

```bash
for cert in /tmp/pki/root/root.cert.pem /tmp/pki/intermediate/intermediate.cert.pem /tmp/pki/server.cert.pem; do
  echo "=== $cert"
  openssl x509 -in "$cert" -noout -subject -issuer -dates
done
```

13) Extract certs from tested service and run reusable expiry script

```bash
mkdir -p /tmp/pki/detected

# Extract full presented chain from the live endpoint under test.
openssl s_client -connect localhost:9443 -showcerts </dev/null 2>/dev/null \
| awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/{print}' > /tmp/pki/detected/service-chain.pem

# Split extracted chain into individual certificate files.
awk 'BEGIN{n=0} /BEGIN CERTIFICATE/{n++} n>0{print > "/tmp/pki/detected/service-cert-" n ".pem"}' /tmp/pki/detected/service-chain.pem

# Reusable expiry script from expiry.md (create once if missing).
if [ ! -x /work/check_expiry.py ]; then
cat > /work/check_expiry.py <<'PY'
#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime, timezone
import argparse
import subprocess
import sys

parser = argparse.ArgumentParser(description="List certs by expiry and alert on threshold.")
parser.add_argument("--path", default=".", help="Root directory to scan")
parser.add_argument("--days", type=int, default=365, help="Alert threshold in days")
args = parser.parse_args()

root = Path(args.path).resolve()
patterns = ("*.pem", "*.crt", "*.cer")
files = []
for p in patterns:
    files.extend(root.rglob(p))

now = datetime.now(timezone.utc)
rows = []

for f in sorted(set(files)):
    try:
        end = subprocess.check_output(
            ["openssl", "x509", "-in", str(f), "-noout", "-enddate"],
            stderr=subprocess.DEVNULL, text=True
        ).strip()
        subj = subprocess.check_output(
            ["openssl", "x509", "-in", str(f), "-noout", "-subject"],
            stderr=subprocess.DEVNULL, text=True
        ).strip()
    except subprocess.CalledProcessError:
        continue

    if not end.startswith("notAfter="):
        continue

    dt = datetime.strptime(end.split("=", 1)[1], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    days = (dt - now).days
    status = "ALERT" if days < args.days else "OK"
    rows.append((dt, days, status, str(f), subj.replace("subject=", "").strip()))

rows.sort(key=lambda r: r[0])

print(f"SCAN_ROOT={root}")
print(f"THRESHOLD_DAYS={args.days}")
print(f"TOTAL_CERTS={len(rows)}")
for dt, days, status, path, subj in rows:
    print(f"{dt.isoformat()} | {days:4d}d | {status} | {path} | {subj}")

alerts = [r for r in rows if r[2] == "ALERT"]
if alerts:
    print(f"ALERT_COUNT={len(alerts)}")
    sys.exit(2)

print("ALERT_COUNT=0")
sys.exit(0)
PY
chmod +x /work/check_expiry.py
fi

# Run on extracted service certs.
/work/check_expiry.py --path /tmp/pki/detected --days 365
echo "exit_code=$?"
```

Stop test service:

```bash
kill "$S_SERVER_PID"
```
