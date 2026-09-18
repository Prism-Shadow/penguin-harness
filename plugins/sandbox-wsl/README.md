# @prismshadow/penguin-plugin-sandbox-wsl

A Windows sandbox backend for PenguinHarness. Each agent command runs in a dedicated WSL2 distro (Ubuntu by default), as an unprivileged account, under [bubblewrap](https://github.com/containers/bubblewrap).

| Dimension  | How                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------ |
| fs-write   | The distro is read-only; the Workspace is bound read-write (or read-only) at its /mnt path |
| network    | `network: "none"` runs the command in an empty network namespace; `"local"` is not supported |
| mask-paths | A tmpfs over a directory, `/dev/null` over a file                                          |

Other Windows drives are hidden from a confined command. The mount that hides them is remounted read-only after the Workspace is bound, so a write to a path outside the Workspace is refused rather than landing in a tmpfs that vanishes with the command.

WSL keeps the generated `resolv.conf` outside the distro's root, at `/mnt/wsl/resolv.conf` or `/run/resolvconf/resolv.conf`, and `/etc/resolv.conf` is a symlink to it. Both are bound back read-only, or covering those directories would leave a reachable network where no host name resolves.

## Setup

Setup is a few tasks the plugin exports, each reporting the step it is on while it runs. Until the distro exists, the backend declines to load and says so.

1. **Install WSL**: raises the Windows consent prompt for `setup/install-wsl.ps1`, which runs `wsl --install --no-distribution`. Some machines need a restart afterwards. This is the only step that needs an administrator.
2. **Initialize sandbox distro**: downloads the base rootfs (checked against its published sha256), imports it as its own distro, installs bubblewrap and the package list (`git` and `curl`), creates the `penguin` account, and switches Windows interop off.
3. **Check confinement**: runs real commands through the sandbox and lists what passed.

State lives in `%LOCALAPPDATA%\penguin\sandbox-wsl` (`state.json`, the downloaded rootfs, the distro's disk).

## Why interop is switched off

With interop on, a Windows program started inside bwrap is an ordinary host process. It escapes every namespace: in a measured run it wrote to the Windows disk and reached the internet with the network cut. The distro's `/etc/wsl.conf` disables interop, the sandbox also hides `/run` where WSL keeps its interop sockets, and the check verifies both.

## The base Linux

| Base | Download | Unpacked | Note |
| --- | --- | --- | --- |
| Ubuntu 24.04 LTS (default) | 29 MB | 84 MB | glibc: what prebuilt binaries, native npm modules and pip wheels expect |
| Alpine | 3.5 MB | 8.7 MB | musl: much smaller, and some prebuilt binaries and wheels do not run |

## Limits

- Commands run in Linux, not Git Bash. Windows toolchains cannot run confined; the distro carries Linux ones instead.
- A Windows path in a command means nothing inside the distro. The Workspace is at `/mnt/<drive>/…`.
- A Workspace on a network share has no path inside the distro and cannot be confined.
- The Workspace is bound at its own path, so the empty directory chain above it (`/mnt/c/Users/…`) is visible even though every other drive is hidden.
