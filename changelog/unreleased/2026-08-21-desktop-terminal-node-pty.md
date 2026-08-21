# Desktop terminals: node-pty ships with the app again

- **Date:** 2026-08-21
- **Type:** fix
- **Scope:** `desktop`, `ci`
- **PR:** [#393](https://github.com/Prism-Shadow/penguin-harness/pull/393)

[中文版](2026-08-21-desktop-terminal-node-pty.zh.md)

Opening a terminal in the desktop app failed with `POST /api/terminals` → 500
`terminal_spawn_failed`, reporting `Cannot find module 'node-pty'` from
`packages/desktop/dist/server.js`. node-pty is a native module and the only dependency the
bundler cannot absorb: the server reaches it through a runtime `require`, and node-pty's own
loader then resolves its binary relative to its package directory. `pnpm build` now stages a
node-pty package directory into `packages/desktop/dist/node_modules`, which both a source run
and a packaged app resolve, and `electron-builder.yml` ships it.

## Details

- `src/pty-payload.ts` selects and copies node-pty's shipping subset — its manifest, its own MIT
  license and vendored winpty's, `lib/`, the `build/Release` binding compiled at install time,
  and the `prebuilds/` binaries — dropping sourcemaps, node-pty's own tests, its TypeScript
  sources, node-gyp inputs, the vendored winpty sources and 44 MB of Windows `.pdb` debug
  symbols. The staged copy is 5.4 MB and covers darwin arm64/x64 and win32 x64/arm64 alongside
  the host build.
- The staging step restores the exec bit on every `spawn-helper` it copies. node-pty publishes
  that darwin side binary as `0644`, which makes `posix_spawnp` refuse it; fixing the mode
  before the app is packed keeps a signed `.app` under `/Applications`, where the server's
  runtime repair cannot write, out of that failure.
- `scripts/build-assets.mjs` resolves node-pty from `packages/server`, where pnpm installs it,
  and fails the build when the staged copy carries no `pty.node` the build host can load.
  node-pty prebuilds darwin and win32 but not Linux, so a Linux install whose node-gyp step
  never ran still stages three bindings, none of which that app could load.
- The `pnpm desktop` preflight checks the staged package, so a stale build says so at launch
  instead of at the first terminal.
- `scripts/terminal-smoke.mjs` now loads node-pty the way the server bundle does — a bare
  `require("node-pty")` anchored at `dist/server.js` — under Electron's own Node, so CI's macOS
  job covers module resolution as well as the ABI and the spawn.
