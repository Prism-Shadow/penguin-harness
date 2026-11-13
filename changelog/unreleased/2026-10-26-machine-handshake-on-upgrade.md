# A machine's handshake brings its process onto this server's build

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1343](https://github.com/Prism-Shadow/penguin-harness/pull/1343)

[中文版](2026-10-26-machine-handshake-on-upgrade.zh.md)

A remote machine whose process runs a different build than this server now answers `GET /api/handshake` with the version and platform digest of the build its process loaded when it started. When that identity disagrees with the build this server has to serve, or the machine does not know the endpoint, this server brings the machine onto that build and asks the handshake once more. A pair that still disagrees is `incompatible`, and every stream from that machine answers an error naming that state.

## Details

- `GET /api/handshake` sits behind the same gate as the version query and answers one `identity`: the build the server process loaded at startup, which a hot update cannot replace. The answer carries no protocol number and no capability list.
- A matching identity changes nothing. A different one, or a `404` from a machine that predates the endpoint, runs the install this server already has (`forceInstaller` on `installOnRemote`), starts the server on its port, and falls back once to the existing stop and start (`stopRemoteServer`, `startRemoteServer`) if the server still disagrees. Every step has a timeout.
- Connecting, the boot sweep and a refused API socket dial enter the same action, and one machine runs it at most once at a time. While it runs, streams answer that the machine is being upgraded.
- After a second handshake still disagrees, the same server process does not run that machine again until its version changes or a person presses retry. The terminal state is kept in memory, with both identities and the last reading.
