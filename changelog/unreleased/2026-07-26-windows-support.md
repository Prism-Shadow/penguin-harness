# Windows support

Windows becomes a supported platform end to end. The one hard blocker was the shell: command sessions unconditionally spawned `bash -lc`, so on Windows every tool call died with ENOENT. There was also no install method, no Windows release artifact, and npm scripts used POSIX-only env prefixes.

## Shell resolution and command sessions

Command sessions now pick their shell once per process: `PENGUIN_SHELL` (explicit name or path, argument shape inferred from the basename) wins on every platform; POSIX otherwise keeps `bash -lc` bit for bit; Windows probes PATH for Git-Bash first (best compatibility with the skill/prompt ecosystem, which is written for a POSIX shell; the WSL launcher in the system directory is ignored), then `pwsh`, then `powershell` (both invoked `-NoLogo -NoProfile -Command`). The resolved shell name is surfaced to the model through a new `{{SHELL}}` placeholder (a `Shell:` line in the default system prompt's Environment section).

Existing agents are covered by an assembly-time fallback: `system_config.yaml` is baked at agent creation and never auto-upgraded, so a pre-`{{SHELL}}` template would never tell the model the shell — and on Windows the model would keep emitting bash syntax into PowerShell. When the platform is win32 and the template has no `{{SHELL}}` placeholder, prompt assembly injects the `- Shell:` line into the rendered Environment section (or appends a minimal final line when the template has no such section) — in-memory only, nothing on disk is rewritten, and POSIX output stays byte-identical. The fallback retires once pre-`{{SHELL}}` agent configs are no longer expected in the wild.

Kill semantics degrade explicitly on Windows: there are no process groups or real signals, so every escalation becomes a `taskkill /pid <pid> /t /f` whole-tree kill — including `input_command`'s Ctrl-C, since a console interrupt cannot be delivered to a piped child. Documented in the tools doc and the installation caveats.

## Installer, release package, and PATH hygiene

`irm https://penguin.ooo/install.ps1 | iex` installs on Windows: the forwarder downloads the real installer fully before executing it (a cut connection can never half-run it) and runs it as an in-memory script block so the default `Restricted` execution policy cannot break it. `install.ps1` mirrors `install.sh` — sha256 verification, staged rename-then-delete swap of `bin`/`lib`/`web`/`node` that never touches `data\`, launcher shim generation, and a clear locked-file error. The release workflow ships `penguin-win32-x64.zip` (official win-x64 Node runtime, CRLF `penguin.cmd` + `penguin.ps1` shims).

The user `Path` registration goes through the registry preserving the value kind: `[Environment]::GetEnvironmentVariable` expands `REG_EXPAND_SZ` and `SetEnvironmentVariable` writes back `REG_SZ`, which would irreversibly hard-code a user's `%USERPROFILE%`-style Path entries — the installer instead reads the raw unexpanded value, appends `<install>\bin` once, and writes it back with the original kind (created as `REG_EXPAND_SZ` when missing).

## CI, sandbox fix, and scripts

A new `ci-windows` job runs install → build → typecheck → the full test suite on `windows-latest`, plus a PowerShell parse gate for both installer scripts; POSIX-only tests skip via `process.platform` guards in the tests themselves. The new CI surfaced a real sandbox gap: `fs.constants.O_NOFOLLOW` does not exist on win32, so the Workspace upload path's final-segment symlink guard silently vanished there — now guarded via `lstat` on win32 (POSIX keeps the atomic `ELOOP` behavior). `scripts/run-with-env.mjs` replaces the POSIX env-prefix script lines, `.gitattributes` pins LF (CRLF for `*.ps1`), and the docs/landing/README gained Windows install rows and honest caveats (NTFS ACLs instead of 0600, `penguin update` deferred to re-running the installer, execution-policy note, x64-only package).
