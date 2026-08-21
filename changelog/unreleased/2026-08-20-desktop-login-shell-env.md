# Desktop imports the login shell's environment on GUI launches

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `desktop`, `server`, `web`, `docs`
- **PR:** [#370](https://github.com/Prism-Shadow/penguin-harness/pull/370)
- **Issue:** [#351](https://github.com/Prism-Shadow/penguin-harness/issues/351)

[中文版](2026-08-20-desktop-login-shell-env.zh.md)

Made the desktop app read the user's login-shell environment on macOS and Linux GUI launches, so API keys exported in `.zshrc` / `.profile` reach core's model env fallback and the agent shell gets the user's real `PATH` — neither had been visible to an app started from the Dock or a desktop session, forcing keys to be re-entered and agent commands onto the bare system `PATH`.

## Details

- Before anything reads `process.env`, the shell runs the user's `$SHELL` once as an interactive login shell around a sentinel-framed `env -0` dump (NUL separation keeps values containing newlines intact; the frame cuts away rc-file noise), then merges the result **fill-missing-only** — a variable set on the launch itself always wins. The embedded server, and with it the agent shell, inherits the merged environment at fork time.
- `PATH` is the one merged key: the login shell's entries first, launch-time-only entries appended, deduplicated.
- Shell bookkeeping (`_`, `SHLVL`, `PWD`, `OLDPWD`, `TERM`) and `ELECTRON_RUN_AS_NODE` are never imported.
- The probe is best-effort with a 5s hard timeout; any failure leaves the environment untouched. Launches from a terminal (`TERM` set) and Windows skip it entirely. `PENGUIN_NO_LOGIN_SHELL_ENV` opts out.
- Made the env fallback visible: for a model without a stored key, the Models page card shows the environment variable it would read as a status chip — success tone with a check when the server process has the variable, attention tone with an alert when it is missing (that request would fail to authenticate); the tooltip explains both states. The models API reports `envKeyPresent` alongside `envKey` — presence only, the value is never serialized.
- Documented in the desktop quickstart and the configuration reference.
