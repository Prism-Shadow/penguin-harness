# Full access can cut the network

- **Date:** 2026-09-16
- **Type:** fix
- **Scope:** core, server, plugins
- **PR:** [#771](https://github.com/Prism-Shadow/penguin-harness/pull/771)

[中文](2026-09-16-full-access-network.zh.md)

`danger-full-access` short-circuited to unconfined before the network setting was read, so "full access" silently dropped "no network" — the permission button could show a cut that was not happening.

- **Full access with the network open** (and no masked paths) is still genuinely unconfined.
- **Full access that cuts the network or masks a path** now reaches a backend that enforces that while leaving the filesystem unrestricted. This is a small widening of the sandbox contract: a provider may now be handed `danger-full-access`, and must leave files alone while still cutting the network or hiding a path. bwrap, on Linux and inside the WSL backend's distro, binds the root read-write and still `--unshare-net`s; Seatbelt denies no writes and still `(deny network*)`s.
