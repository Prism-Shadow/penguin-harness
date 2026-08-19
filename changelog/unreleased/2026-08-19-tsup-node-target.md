# One Node build target across the workspace

- **Date:** 2026-08-19
- **Type:** process
- **Scope:** `tooling`, `core`, `cli`, `server`, `skills`, `desktop`

[中文版](2026-08-19-tsup-node-target.zh.md)

Every package now compiles for the same Node version — `node24` — and the two published
libraries that had never said which Node they need now declare it.

`target` in a tsup config is the syntax level esbuild emits down to. It had drifted to five
independent answers: `node20` for core, cli and skills, `node22` for server and desktop,
while `engines.node` on the packages that declare it requires `>= 24`, CI runs Node 24 and
releases ship a 24 runtime. Nothing was broken by it — targeting an older Node only means
output that could have been left alone gets transpiled — but "which Node do we build for"
had no single answer, and every new package was a coin flip.

## Details

- `@prismshadow/penguin-core` and `@prismshadow/penguin-skills` gain
  `engines: { "node": ">=24" }`. They are published, they now emit Node 24 syntax, and
  saying so is what makes npm refuse the install rather than letting a Node 20 user meet a
  `SyntaxError` at import time. Both are already built and tested only on 24, and both are
  consumed by packages that require it.
- A drift guard in `packages/cli/test/tsup-target.test.ts` asserts every tsup config
  declares the same target and that no published package emits syntax newer than its
  `engines` admits to needing. It lives in `packages/cli` because the repo root runs no
  suite of its own, following `dev-script-entry.test.ts`.
