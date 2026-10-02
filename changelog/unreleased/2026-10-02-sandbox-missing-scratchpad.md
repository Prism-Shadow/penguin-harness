# Commands start in the sandbox before the Session scratchpad exists, or after it is deleted

- **Date:** 2026-10-02
- **Type:** fix
- **Scope:** `server`, `core`

[中文版](2026-10-02-sandbox-missing-scratchpad.zh.md)

Under `workspace-write`, the Session scratchpad is bound writable into the sandbox. It is created only when something is first written into it, and deleting a Session's scratchpad removes it while the Session lives. Until then, bubblewrap — the Linux backend and the one inside the Windows WSL backend — refused to start on the missing bind source, so every command and hook of that Session failed.

- The sandbox service creates the Session scratchpad before each confined spawn when it is missing, and leaves an existing one untouched.
- When the scratchpad cannot be created, the command fails with an error naming the scratchpad and the underlying errno; it does not run without the scratchpad.
- `SandboxPolicy.writableRoots` documents that each root exists on the host when a backend receives the policy, and that a backend neither creates nor skips one.
