# One door to a machine: machines/transport/

- **Date:** 2026-09-01
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#567](https://github.com/Prism-Shadow/penguin-harness/pull/567)

[中文版](2026-09-01-machines-transport.zh.md)

Reaching another machine moves behind one directory. `machines/exec.ts` and `machines/targets.ts` become `machines/transport/exec.ts` and `machines/transport/targets.ts`, private behind `transport/index.ts`, and a test scans the source to keep them there. No behavior changes.

## Details

- **The rule is about authority, not sockets.** Opening ssh is how this server acts on a machine at all, so it is worth one place that owns it rather than a spawn at each call site. A caller that opens its own channel also judges the machine by that channel — and "my ssh worked" is not the same fact as "that machine is healthy". Keeping the door single is what lets those be told apart.
- **Pinned by a source scan** (`machines-transport-boundary.test.ts`) rather than by agreement: nothing outside the directory may spawn `ssh`/`scp`, reach past `transport/index.js`, or import the modules at their old top-level paths. It runs with the suite everywhere and names the offending file. Tests are exempt, since a unit test of a private module imports it by nature.
- **What sits behind the door is expected to change.** The raw runners the index exports today are what the install path needs; they narrow to a per-machine connection handle once one exists, and a caller importing only from the index will not notice.
