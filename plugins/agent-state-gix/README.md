# @penguinharness/agent-state-gix

gitoxide for PenguinHarness Agent State history: the two engine steps — writing a workbench
version, reading it back — run in native code, in-process, with no Git process and no packaged
Git to ship.

It contributes one engine to the server's `AgentStateHistoryModule.engines` slot. Its commits
are the same bytes the real-Git engines write, so the repository never notices which engine
wrote; the interchange tests pin that by commit id equality against real Git.

## Build

The native half is a Rust crate under `native/` (napi + gitoxide). Building it needs a Rust
toolchain:

```
pnpm build:native   # cargo build --release, laid at native/index.node
pnpm build          # gen-ifaces + tsup
pnpm test           # the interchange suite against real Git
```
