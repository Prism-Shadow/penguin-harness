# A WSL sandbox backend for Windows, set up from its own card

- **Date:** 2026-09-17
- **Type:** feat
- **Scope:** plugins, server, web
- **PR:** [#771](https://github.com/Prism-Shadow/penguin-harness/pull/771)

[中文](2026-09-17-wsl-sandbox.zh.md)

The Windows backend, `sandbox-wsl`, confines each agent command inside a dedicated WSL2 distro, as an unprivileged account, under bubblewrap. The distro is Ubuntu 24.04 by default; Alpine is the small option, at a tenth of the download and the musl limits that come with it. It implements fs-write, network and mask-paths.

- **The distro is read-only and the Windows drives are hidden.** The Workspace is bound back in at its `/mnt/<drive>/…` path, read-write or read-only by mode. `network: "none"` leaves the command in an empty network namespace. A masked directory gets a tmpfs, a masked file `/dev/null`.
- **A refused write says so.** The mount that hides the Windows drives is remounted read-only once the Workspace is bound: before that it was a writable tmpfs, so `echo x > /mnt/c/Users/anything` reported success into a file that existed for one command and never reached Windows. The check now fails a refusal that reports success.
- **Names resolve.** WSL keeps the generated `resolv.conf` outside the distro's root and `/etc/resolv.conf` points at it, so covering `/mnt` and `/run` left a reachable network where every host name failed. Both candidate paths are bound back read-only, and the check resolves a name as well as opening a connection.
- **Windows interop is switched off inside the distro.** With it on, a Windows program started inside bwrap is an ordinary host process: it wrote to the Windows disk and reached the internet with the network cut. The profile also hides `/run`, where WSL keeps its interop sockets.
- **Setup is a few tasks, each reporting the step it is on.** Install WSL raises one Windows consent prompt and follows `wsl --install`'s output as it runs. Initialize downloads the base rootfs (checked against its sha256), imports it, installs bubblewrap and the package list through apt or apk, and needs no administrator. Check confinement runs real commands through the sandbox and lists each result. Remove distro unregisters it. Until the distro exists, the backend declines to load and says so.
- **Commands run in Linux.** Windows toolchains cannot run confined; the distro's package list supplies Linux ones.
