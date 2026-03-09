
## Linux CentOS 7 - Manually Updating Trusted Certificates

You can manually add a certificate to the system trust store by copying the certificate to either the /usr/share/pki/ca-trust-source/anchors/ or /etc/pki/ca-trust/source/anchors/ directories. You must run the update-ca-trust command to refresh the system trust store after you make manual updates to these directories. 

For example:

```
sudo cp /path/to/public.cert /etc/pki/ca-trust/source/anchors
sudo update-ca-trust
```

See the update-ca-trust(8) manual page for more information.

Source: [https://docs.oracle.com/en/operating-systems/oracle-linux/certmanage/manually_adding_trusted_certificates.html](https://docs.oracle.com/en/operating-systems/oracle-linux/certmanage/manually_adding_trusted_certificates.html)

## Red Hat certificate management with Ansible

On RHEL/CentOS/Fedora, custom trust anchors are typically placed in:
- `/etc/pki/ca-trust/source/anchors/`

Then trust is rebuilt with:
- `update-ca-trust extract` (or just `update-ca-trust`)

Example Ansible tasks (install custom CA):

```yaml
- name: Install custom CA certificate
  copy:
    src: files/my-root-ca.pem
    dest: /etc/pki/ca-trust/source/anchors/my-root-ca.pem
    owner: root
    group: root
    mode: "0644"
  notify: Refresh CA trust
```

Handlers:

```yaml
- name: Refresh CA trust
  command: update-ca-trust extract
```

Example removal tasks (cleanup):

```yaml
- name: Remove custom CA certificate
  file:
    path: /etc/pki/ca-trust/source/anchors/my-root-ca.pem
    state: absent
  notify: Refresh CA trust
```

Example blacklisting/distrust tasks (stronger than removal):

```yaml
- name: Add certificate to distrust list
  copy:
    src: files/my-root-ca.pem
    dest: /etc/pki/ca-trust/source/blacklist/my-root-ca.pem
    owner: root
    group: root
    mode: "0644"
  notify: Refresh CA trust

- name: Ensure same cert is not trusted as anchor
  file:
    path: /etc/pki/ca-trust/source/anchors/my-root-ca.pem
    state: absent
  notify: Refresh CA trust
```

Optional task to remove distrust entry (allow future trust again):

```yaml
- name: Remove certificate from distrust list
  file:
    path: /etc/pki/ca-trust/source/blacklist/my-root-ca.pem
    state: absent
  notify: Refresh CA trust
```

Notes on behavior:
- Removal from `anchors/` just stops explicit trust.
- Blacklist/distrust actively blocks trust while the blacklist entry exists.

Optional verification taskset (fingerprint-based):

```yaml
- name: Read SHA256 fingerprint of custom CA
  shell: |
    openssl x509 -in /etc/pki/ca-trust/source/anchors/my-root-ca.pem \
      -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':'
  register: my_root_ca_fp
  changed_when: false

- name: Verify custom CA exists in extracted system bundle
  shell: |
    awk 'BEGIN{n=0} /BEGIN CERTIFICATE/{n++} {print > "/tmp/rh-ca-" n ".pem"}' /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem
    for c in /tmp/rh-ca-*.pem; do
      openssl x509 -in "$c" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':' | grep -q "^{{ my_root_ca_fp.stdout }}$" && exit 0
    done
    exit 1
  changed_when: false
```

Notes:
- Use `anchors/` for trusted custom roots.
- Effective system bundle is generated under `/etc/pki/ca-trust/extracted/...`.
- For app-specific trust, prefer app-level CA bundle config instead of global OS trust changes.


## Security controls (paragraph version)

Allowlist trust anchor: use this when you want to trust a specific private/public CA. On RHEL, place the certificate in `/etc/pki/ca-trust/source/anchors/` and run `update-ca-trust extract`. In Ansible, this is usually a `copy` task plus a handler. Verify with `openssl verify` against `/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem`.

Remove custom trust: use this to stop explicitly trusting a custom CA. Remove the certificate from `anchors/` and refresh trust. In Ansible, use `file: state=absent` and the same handler. Verify by checking that certificate fingerprint is no longer present in the extracted bundle.

Blacklist/distrust: use this to explicitly block a certificate/CA (stronger than removal). Put the certificate into `/etc/pki/ca-trust/source/blacklist/` and run trust extraction. In Ansible, use `copy` to `blacklist/` and optionally remove the same cert from `anchors/`. Verify that target chain validation fails.

Unblock (remove distrust): use this when you want to allow trust again later. Remove the certificate from `blacklist/` and refresh trust. In Ansible, this is again `file: state=absent` plus handler. Verify that validation succeeds when the anchor is present.

App-scoped trust: use this when you want minimal blast radius and no global OS changes. Keep certificate bundles outside OS trust-store and pass them per app (`--cacert`, `CURL_CA_BUNDLE`, app-specific settings). Verify that app calls succeed while system trust-store remains unchanged.

Pinning: use this to reduce CA-compromise risk by checking expected key material. This is app-level, not OS trust-store level. For curl, use `--pinnedpubkey`. Verify by testing a mismatched key and confirming the request fails.

Revocation checks: use this to detect revoked certificates (CRL/OCSP). Behavior depends on the client/library, so configure revocation settings per tool. Verify with a revoked test cert and confirm rejection.

Change approval: use change-control to prevent unauthorized trust updates. Gate trust-store modifications via PR/ticket review and auditing. In automation, enforce approvals in CI and repository policies. Verify by ensuring an auditable trail exists.

Permissions hardening: restrict who can change trust paths and run trust updates. Keep trust-store writes root-only and apply least-privilege sudo policy. Verify by attempting unauthorized writes and confirming they are denied.

MITM policy: define where interception is allowed and where it is forbidden. Trust proxy CA only for approved clients/environments and keep scope explicit. Verify by confirming only intended clients trust the proxy CA.
