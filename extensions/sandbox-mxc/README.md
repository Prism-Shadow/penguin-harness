# Windows sandbox backend (Microsoft MXC)

Confines command subprocesses on Windows through
**MXC** (Microsoft eXecution Containers), using its `processcontainer` backend.
Implements **all three** dimensions of the harness sandbox interface.

## Why this exists

Windows has neither bubblewrap nor `sandbox-exec`, and the DSH adaptor's Windows rung
(restricted tokens plus ACLs) governs file writes only. MXC's `processcontainer` backend
is the one Windows mechanism that expresses all three dimensions, and it maps onto them
directly:

| Harness dimension | MXC |
| --- | --- |
| `fs-write` | `filesystem.readwritePaths` / `readonlyPaths` |
| `mask-paths` | `filesystem.deniedPaths` |
| `network` | `network.allowOutbound: false` (MXC already defaults to deny) |

## Requirements

- Windows.
- `@microsoft/mxc-sdk`, an **optional peer dependency**. It carries roughly 40MB of
  per-platform binaries plus a native pty module, so only a deployment that actually wants
  this backend pays for them. It is reached through a dynamic import, and a missing SDK
  fails this backend's load — reported fail-closed — rather than the platform bundle's.

## Windows only, deliberately

MXC also ships Linux (bubblewrap/LXC) and macOS (Seatbelt) backends, but this harness
already has native, live-verified extensions for those. Declaring them here would add an
untested second path to a solved problem, so on any non-Windows host this backend declines
and routing moves on.

## Install

Add the specifier to your deployment's `extensions.json` and restart, or push a platform that
carries it:

```json
{ "extensions": ["@prismshadow/penguin-extension-sandbox-mxc"] }
```

Installing is an operator-side action: the harness resolves the package from the installation,
never from this listing.

## License

Apache-2.0.
