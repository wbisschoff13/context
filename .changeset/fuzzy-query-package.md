---
"@wbisschoff13/libref": patch
---

`libref query` and the MCP `get_docs` tool now accept a bare package name (e.g. `opentofu`) in addition to `name@version`. A `registry/name[@version]` prefix is also accepted, so a spec copied from `libref install` works directly in `libref query`. As a final fallback for bare inputs, the second-level domain or full main domain (e.g. `cloudflare` or `cloudflare.com`) matches an installed site package like `developers.cloudflare.com` when no exact name is installed.
