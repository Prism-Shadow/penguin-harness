# The desktop app's Feishu binding connects again

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `desktop`, `tooling`
- **PR:** [#482](https://github.com/Prism-Shadow/penguin-harness/pull/482)

[中文版](2026-08-27-desktop-bundle-cjs-globals.zh.md)

Binding a Feishu app from the desktop app failed at the credential test and at connect with
`__dirname is not defined`, so the messaging integration that shipped in 0.2.6
([#464](https://github.com/Prism-Shadow/penguin-harness/pull/464)) could not be used there at
all. Only the desktop app was affected: an npm or CLI install resolves
`@larksuiteoapi/node-sdk` from `node_modules`, where it runs as CommonJS and is handed its own
`__dirname`, while the desktop app bundles the server and the CLI into one self-contained ESM
file each and absorbs the SDK along with them. Those bundles carried a banner declaring
`require` for exactly this reason, but not `__filename` or `__dirname` — so the SDK's read of
its own `package.json`, which it uses to put a version into its User-Agent header, hit an
undeclared identifier and failed the whole connect attempt.

The banner was moved to a single definition in `scripts/esm-cjs-banner.mjs` and taught to
declare all three, and both bundling sites were pointed at it:
`packages/desktop/tsup.config.ts`, which builds the shipped app, and `compileEntry` in
`scripts/deploy.mjs`, which builds the hot-update platform and CLI bundles and would have met
the same wall on a push. Telegram bindings were never affected — that connector speaks HTTP
directly and loads no SDK.

## Details

The declarations restore the identifiers, not CommonJS's meaning of them: inside a bundle
`__dirname` names the bundle's own directory, not the directory the dependency was published
in. A dependency that reads it to find a file shipped beside itself still looks in the wrong
place, and one that must reach its own files cannot be bundled at all — which is why node-pty
ships as a real package directory next to the bundles instead. The Feishu SDK stays inside that
limit: its version lookup already falls back to `unknown` when it finds nothing, so the wrong
directory costs a version tag in a request header and nothing else.
