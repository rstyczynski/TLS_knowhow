# Terraform received CA list

Recommended design: pass CA entries as structured objects so you can keep metadata and PEM content together.

```hcl
variable "ca_list" {
  description = "List of CA certificates loaded from JSON input."
  type = list(object({
    name        = string
    pem         = string
    trusted     = optional(bool, true)
    fingerprint = optional(string)
  }))
}
```

Example `terraform.tfvars.json`:

```json
{
  "ca_list": [
    {
      "name": "local-root-ca",
      "pem": "-----BEGIN CERTIFICATE-----\nMIIC...snip...\n-----END CERTIFICATE-----\n",
      "trusted": true,
      "fingerprint": "A1B2C3D4E5F6..."
    },
    {
      "name": "local-intermediate-ca",
      "pem": "-----BEGIN CERTIFICATE-----\nMIID...snip...\n-----END CERTIFICATE-----\n",
      "trusted": true
    }
  ]
}
```

Minimal option (if you only need PEM strings):

```hcl
variable "ca_pems" {
  type = list(string)
}
```

```json
{
  "ca_pems": [
    "-----BEGIN CERTIFICATE-----\nMIIC...snip...\n-----END CERTIFICATE-----\n",
    "-----BEGIN CERTIFICATE-----\nMIID...snip...\n-----END CERTIFICATE-----\n"
  ]
}
```

## Base64 design (JSON-friendly)

Use base64 when you want to avoid `\n` escaping in JSON.

```hcl
variable "ca_list_b64" {
  description = "CA list with PEM payload encoded as base64."
  type = list(object({
    name    = string
    pem_b64 = string
    trusted = optional(bool, true)
  }))
}

locals {
  ca_list_decoded = [
    for c in var.ca_list_b64 : {
      name    = c.name
      pem     = base64decode(c.pem_b64)
      trusted = c.trusted
    }
  ]
}
```

Example `terraform.tfvars.json`:

```json
{
  "ca_list_b64": [
    {
      "name": "local-root-ca",
      "pem_b64": "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUMuLi4KLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQo=",
      "trusted": true
    },
    {
      "name": "local-intermediate-ca",
      "pem_b64": "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUQuLi4KLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQo=",
      "trusted": true
    }
  ]
}
```

Tip:
- Generate base64 from a PEM file with: `base64 -i my-root-ca.pem | tr -d '\n'`
