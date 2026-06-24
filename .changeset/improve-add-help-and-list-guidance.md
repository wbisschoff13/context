---
"@wbisschoff13/libref": patch
---

- `libref list` now directs users to `libref add <source>` (URL, GitHub repo, website, or local .db file) instead of only mentioning a local .db file.
- `libref add --help` (and the `add` row in `libref --help`) now makes the website fallback chain explicit: any website URL works — libref auto-fetches `llms.txt`, then falls back to `sitemap.xml`. The MCP tool descriptions shown to agents (`search_packages`, `MISSING_PACKAGE_GUIDANCE`) say the same.
