# The Windows sandbox keeps your real home, and full access can cut the network

- **Date:** 2026-09-16
- **Type:** fix
- **Scope:** core, server, plugins
- **PR:** [#767](https://github.com/Prism-Shadow/penguin-harness/pull/767)

[中文](2026-09-16-windows-home-and-full-access.zh.md)

Two things about the Windows account sandbox were wrong, and both are fixed.

- **A confined command's home was remapped** to `C:\ProgramData\penguin\sandbox-home`, so `~/.gitconfig`, `~/.ssh`, tool caches and the harness's own config were all invisible, and a "write your home" test wrote to a decoy and reported success. The home is now the real one. The setup grants the sandbox accounts **read** on your profile once (a full-access account gets **modify**), the same shape the Linux and macOS sandboxes give — the agent can read your home under the sandbox, and only writes are confined. The one thing still redirected is the temp directory, to a shared writable folder, and only when "temp writable" is on.
- **Full access and a network cut could not both hold.** `danger-full-access` short-circuited to unconfined before the network setting was read, so "full access" silently dropped "no network" — the permission button could show a cut that was not happening. Full access with the network open (and no masked paths) is still genuinely unconfined. Full access that **cuts the network or masks a path** now reaches a backend that enforces that while leaving the filesystem unrestricted. This is a small widening of the sandbox contract: a provider may now be handed `danger-full-access`, and must leave files alone while still cutting the network or hiding a path. bwrap binds the root read-write and still `--unshare-net`s; seatbelt denies no writes and still `(deny network*)`s; the Windows backend runs the command as a network-blocked account whose home is writable.
- **The Windows backend now has four accounts** — the network axis (open / blocked) crossed with the filesystem axis (home read-only / writable) — so each account's reach is granted once at setup and no command re-permissions your profile, which on a large one would take minutes.

## 兼容性

This changes what the Windows setup script leaves behind (four accounts, a profile grant, a shared temp folder) and the shape of its state file, so the state from an earlier build reads as "not set up". Re-run the setup once — the Sandbox card offers the button, or run `setup\penguin-sandbox-setup.ps1` from an elevated PowerShell. Until it is re-run, the Windows sandbox declines to load and confining modes fail closed rather than running unconfined; `-Remove` on the new script also takes the old accounts, group and rules away. The first re-run is slower than before because it grants the accounts access to your profile. This note can go once no Windows host still holds a two-account state file.
