# Windows: the package bundles its own bash, so the Agent's shell no longer depends on the machine

- **Date:** 2026-07-27
- **Type:** feature
- **Scope:** `core`, `tooling`
- **PR:** [#95](https://github.com/Prism-Shadow/penguin-harness/pull/95)

[中文版](2026-07-27-windows-bundled-shell.zh.md)

`penguin-win32-x64.zip` now ships **MinGit** under `git/`, and `exec_command` uses it when the machine has no Git for Windows of its own.

## The shell was whatever the machine had

The Windows shell was whatever happened to be installed: `bash` if the user had Git for Windows, otherwise PowerShell. That made the same Agent running the same Skill behave differently on two Windows machines, and the degradation was silent — a Skill written for a POSIX shell does not fail loudly under PowerShell, it fails strangely. The sharpest case: `curl -fsSL <url>` under Windows PowerShell 5.1 resolves the built-in `curl` → `Invoke-WebRequest` alias and returns a cmdlet parameter-binding error, which a model recovers from far less easily than "command not found".

## What is bundled

MinGit's `usr/bin/sh.exe` **is GNU bash** — the minimal Git for Windows build installs bash under the name `sh`. So the bundle costs 37MB compressed (~91MB installed) for a real bash, roughly sixty core utilities, and `git.exe`, rather than the ~350MB extracted that full PortableGit would have needed for complete parity.

No PATH plumbing is involved. MinGit's `etc/profile` defaults to `MSYS2_PATH_TYPE=inherit`, so a login shell (`-lc`, unchanged) yields `/mingw64/bin:/usr/local/bin:/usr/bin:/bin:<inherited Windows PATH>` — bundled tools and git first, the Windows PATH still behind them. That is why MinGit carrying no `curl` or `tar` does not matter: System32's `curl.exe` and `tar.exe` keep resolving, and inside bash they are the real binaries rather than PowerShell aliases.

## Resolution order

`PENGUIN_SHELL` → `bash` on PATH → **bundled** → `pwsh` → `powershell`.

The bundle sits deliberately *after* the PATH probe: a user's own Git for Windows carries the complete MSYS userland (curl, tar, less, perl …) while MinGit carries about sixty tools, so when both exist theirs is the better shell. The bundle is the floor, not the preference. `pwsh` / `powershell` stay reachable for npm installs, which bundle nothing. The resolved shell is reported to the model as `bash`, since that is what it is and what the Skill ecosystem targets.

The installer treats `git/` like the other payload directories — replaced on upgrade, never touching the data directory — and the launcher shims advertise the path as `PENGUIN_BUNDLED_SHELL`.

## Licensing

MinGit is GPLv2, so a new root `THIRD-PARTY-NOTICES.md` records both bundled components — the Node runtime and MinGit — with where each one's license text sits inside the bundle and where its corresponding source lives. The Git for Windows release is pinned to one exact tag so the notice names a single version, and the bundled bytes are the unmodified published asset.

## Cost, stated plainly

The Windows download roughly doubles (~65MB → ~100MB) and the install grows about 91MB; `Expand-Archive` on PowerShell 5.1 has 368 more files to unpack, so a fresh install is noticeably slower. The bundle also means a *hybrid* environment — MSYS coreutils beside native node and git — not a POSIX one, so MSYS path translation remains a thing to watch. `MSYS_NO_PATHCONV` / `MSYS2_ARG_CONV_EXCL` are deliberately left unset: matching real Git Bash semantics is the least surprising default, and diverging would make the bundled shell behave unlike the PATH one.
