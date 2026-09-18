# Sandbox backends: WSL on Windows, a bundled bubblewrap, load-time checks, and no MXC

- **Date:** 2026-09-17
- **Type:** feat
- **Scope:** `core`, `server`, `plugins`, `build`, `tooling`
- **PR:** [#771](https://github.com/Prism-Shadow/penguin-harness/pull/771)

[中文版](2026-09-17-sandbox-backends.zh.md)

Windows gets a sandbox backend that runs commands in a WSL2 distro under bubblewrap. On Linux the bwrap backend brings its own bubblewrap. Every native backend checks at load that it can serve, confining modes keep a writable temp directory, full access can still cut the network, and the MXC backend is removed.

## Windows: the WSL backend

`sandbox-wsl` confines each agent command inside a dedicated WSL2 distro, as an unprivileged account, under bubblewrap. The distro is Ubuntu 24.04 by default; Alpine is the small option, at a tenth of the download and the musl limits that come with it. It implements fs-write, network and mask-paths.

- **The distro is read-only and the Windows drives are hidden.** The Workspace is bound back in at its `/mnt/<drive>/…` path, read-write or read-only by mode. `network: "none"` leaves the command in an empty network namespace. A masked directory gets a tmpfs, a masked file `/dev/null`.
- **A refused write says so.** The mount that hides the Windows drives is remounted read-only once the Workspace is bound, so `echo x > /mnt/c/Users/anything` fails instead of succeeding into a tmpfs that vanishes with the command.
- **Names resolve.** WSL keeps the generated `resolv.conf` outside the distro's root and `/etc/resolv.conf` points at it. Both candidate paths are bound back read-only, so hiding `/mnt` and `/run` does not break name resolution.
- **Windows interop is switched off inside the distro.** With it on, a Windows program started inside bwrap is an ordinary host process: it wrote to the Windows disk and reached the internet with the network cut. The profile also hides `/run`, where WSL keeps its interop sockets.
- **Setup is a few tasks, each reporting the step it is on.** Install WSL raises one Windows consent prompt and follows `wsl --install`'s output as it runs. Initialize downloads the base rootfs (checked against its sha256), imports it, installs bubblewrap and the package list through apt or apk, and needs no administrator. Check confinement runs real commands through the sandbox and lists each result. Remove distro unregisters it. Until the distro exists, the backend declines to load and says so.
- **Commands run in Linux.** Windows toolchains cannot run confined; the distro's package list supplies Linux ones.
- **The confinement seam can carry environment.** A backend's `ConfinedArgv` (and the platform's `SpawnConfiner`) may name entries laid over the command's environment at spawn. The WSL launcher is a script run by the server's own interpreter, which in the desktop app is the app binary and runs a script only under `ELECTRON_RUN_AS_NODE`.

## Linux and macOS: no dependency on the host

- **The bwrap plugin ships `bwrap` itself**, one binary per architecture (`linux-x64`, `linux-arm64`), with the libcap it loads and both licenses beside it. `scripts/vendor-bwrap.mjs` vendors them at build time from conda-forge, pinned by exact URL and sha256; a hash that does not match fails the build. The binary finds its library through an `$ORIGIN/../lib` rpath.
- **Precedence at each spawn:** the one the plugin ships, else a `bwrap` on PATH. A host with neither still fails closed, now saying to check `kernel.unprivileged_userns_clone`.
- **Seatbelt names `/usr/bin/sandbox-exec` by its absolute path**, so a PATH without `/usr/bin`, or with another program of that name first, no longer decides what confines a command.
- The bwrap backend's live enforcement tests run against the shipped binary on a host with no bubblewrap of its own.

## Every backend

- **A backend checks at load that it can serve.** bwrap and Seatbelt load through `loadPenguinBwrapProvider` / `loadSeatbeltProvider`. Off their own platform they decline; on it they run their base-profile probe without blocking and reject, with the reason, when the runner is missing or refuses the profile. Before, a Windows host counted bwrap as a mounted backend covering every dimension and routed every confining policy to it. The confine-time probe stays.
- **Nothing is silently absent.** `SandboxService` settles every backend source at once, in routing order, and records a rejection as a failure and a null as a decline. When a command fails closed, the message names both: `backends not in use: <name> (<reason>); <name> (not for this host)`.
- **The temp directory is writable in either confining mode.** `SandboxPolicy` gained `writableTemp`, and the service sets it on every confining policy: bwrap mounts a private, writable `/tmp` (binding `$TMPDIR` too when it lives elsewhere) and Seatbelt allows the temp areas. Before, `read-only` left them read-only, and shells failed before running anything.
- **The network has a local level.** Beside no network and an open one, `network: "local"` lets a command reach the host's localhost and nothing else. It is its own dimension, `network-local`, so the service routes it only to a backend that declares it and fails closed elsewhere. Seatbelt implements it (every socket denied, then localhost let back in); bwrap and WSL cannot, because an empty network namespace loses the host's loopback too, and they refuse it rather than read it as an open network.
- **Full access can cut the network.** `danger-full-access` used to short-circuit to unconfined before the network setting was read. Full access with the network open and no masked paths is still unconfined; full access that cuts the network or masks a path now reaches a backend that enforces that while leaving files alone. bwrap, on Linux and inside the WSL distro, binds the root read-write and still `--unshare-net`s; Seatbelt denies no writes and still `(deny network*)`s.
- **The MXC backend is removed.** `plugins/sandbox-mxc` is gone and `@microsoft/mxc-sdk` left the workspace. The builtin plugin registry lists four sandbox backends: bwrap, Seatbelt, WSL and the DSH adaptor.
