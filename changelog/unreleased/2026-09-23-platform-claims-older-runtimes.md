# A pushed platform boots on runtimes older than the Penguin Go origin

- **Date:** 2026-09-23
- **Type:** fix
- **Scope:** `server`

[中文版](2026-09-23-platform-claims-older-runtimes.zh.md)

A hot push replaces the platform and never the runtime, so the platform must boot on every runtime already installed. `penguinGoOrigin` had been added to the config members the platform requires of the runtime, which made every push to a runtime installed before it fail with `this runtime publishes no business capabilities this platform can claim (config: missing penguinGoOrigin)` — and each refused push still restarted the server.

- Removed `penguinGoOrigin` from the required config members. `penguinGoOrigin` and `modelscopeBridgeUrl` are optional on the server config, like `cliEntry`: a runtime that does not publish them gets the production defaults (`https://token.penguin.ooo`, `https://go.penguin.ooo/modelscope`) in the Penguin Go and ModelScope authorization providers.
- A test now pins the rule: a config member added after runtimes shipped is never in the required list.
