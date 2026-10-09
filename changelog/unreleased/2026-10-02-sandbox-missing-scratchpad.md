# Commands start in the sandbox before the Session scratchpad exists, or after it is deleted

- **Date:** 2026-10-02
- **Type:** fix
- **Scope:** `server`, `core`
- **PR:** [#976](https://github.com/Prism-Shadow/penguin-harness/pull/976)

[中文版](2026-10-02-sandbox-missing-scratchpad.zh.md)

Under `workspace-write`, the Session scratchpad is bound writable into the sandbox. It is created only when something is first written into it, and a command, an agent or the user can remove it while the Session lives. While it was missing, bubblewrap — the Linux backend and the one inside the Windows WSL backend — refused to start on the missing bind source, so every command and hook of that Session failed.

- Under `workspace-write`, the sandbox service creates the Session scratchpad before each confined spawn when it is missing, and leaves an existing one untouched. Other modes do not bind it and do not create it.
- When the scratchpad cannot be created, the command fails with an error naming the scratchpad and the underlying errno; it does not run without the scratchpad.
- `SandboxPolicy.writableRoots` documents that each root exists on the host when a backend receives the policy, and that a backend neither creates nor skips one.
