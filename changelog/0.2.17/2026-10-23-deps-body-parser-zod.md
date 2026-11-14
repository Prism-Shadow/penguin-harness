# Dependencies: body-parser 1.20.9 and zod 4.6.7

- **Date:** 2026-10-23
- **Type:** fix
- **Scope:** `core`, `server`, `cli`
- **PR:** [#1306](https://github.com/Prism-Shadow/penguin-harness/pull/1306)

[中文版](2026-10-23-deps-body-parser-zod.zh.md)

Refreshed two transitive copies in the lockfile to clear two high-severity Dependabot alerts. Every parent's existing range already admits the patched release, so no manifest range and no workspace override changed.

- **body-parser 1.20.6 → 1.20.9** — GHSA-27r3-jxmh-p828 (denial of service through trailing bytes after a compressed request body; patched in 1.20.9). It comes in through `@prismshadow/mmsp` → `express` 4.22.2 (`~1.20.5`); only mmsp's `integration/*` entry points load express, and the harness imports none of them.
- **zod 4.4.3 → 4.6.7** — GHSA-mrhx-c7xc-m3w5 (memory exhaustion while validating oversized constrained collections; patched in 4.6.6). zod is a runtime dependency of the MCP SDK (`@modelcontextprotocol/client` in `core` and `cli`, `^4.2.0`), an optional peer of the Anthropic and OpenAI SDKs under mmsp, and core's devDependency for its MCP test fixtures. 4.6.7 is the newest release in `^4.2.0`.
