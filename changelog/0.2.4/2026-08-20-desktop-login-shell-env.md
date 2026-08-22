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
- Shell bookkeeping (`_`, `SHLVL`, `PWD`, `OLDPWD`, `TERM`) and `ELECTRON_RUN_AS_NODE` are never imported, nor are `PENGUIN_WEB_DIST` and `PENGUIN_CLI_ENTRY` — they pick which code the embedded server serves and self-updates through, so a profile line written for a repo checkout must not retarget an installed app.
- The probe is best-effort with a 5s hard timeout; any failure leaves the environment untouched. Launches from a terminal (`TERM` set) and Windows skip it entirely. `PENGUIN_NO_LOGIN_SHELL_ENV` opts out.
- Made the env fallback visible, for first-party official entries only (vendor group, catalog shape unmodified — gateway, custom and user-defined groups are excluded, so the official `OPENAI_API_KEY` is never steered toward a reseller endpoint): with no stored key and the variable detected, the card's key slot and the model dialog both show the variable's value masked by the same rule as stored keys — the dialog putting "Read from environment variable" in the created-at position, and offering no clear control; storing a key still overrides the variable. The models API reports `envKeyMasked` alongside `envKey` — masked preview only, the plaintext is never serialized.
- Narrowed the "leave the key empty and the environment covers it" hint — the model dialog's API key placeholder, the note under it, and the group-wide key dialog's placeholder — to variables the server reported a value for. Knowing which variable a provider reads says nothing about whether it is set, so the hint used to promise an empty field would work on machines where it would have left the model with no key at all.
- Documented in the desktop quickstart and the configuration reference.
