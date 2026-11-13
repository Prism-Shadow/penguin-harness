# The docs say a remote machine must run the server's version

- **Date:** 2026-10-26
- **Type:** process
- **Scope:** `docs`, `landing`
- **PR:** [#1340](https://github.com/Prism-Shadow/penguin-harness/pull/1340)

[中文版](2026-10-26-docs-machine-version.zh.md)

The Updates docs page gained an "Update remote machines" section: a remote machine must run the same version as the server it is connected to. After updating the server, bring every machine to that version from the **Machines** page (**Update** on one machine, or **Update all**); restart a machine's server if it shows the server's version but still cannot connect, and reinstall that version if a restart does not help. The 0.2.17 release post's Upgrading list gained the same bullet.
