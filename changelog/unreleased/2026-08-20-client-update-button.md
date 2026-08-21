# Update the desktop client from the account menu

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`, `server`, `desktop`
- **PR:** [#386](https://github.com/Prism-Shadow/penguin-harness/pull/386)

[中文版](2026-08-20-client-update-button.zh.md)

Added a client-update row to the sidebar user menu of the desktop shell's own window — the slot where the server self-update row hides in desktop mode. The row drives the shell's electron-updater end to end: check, background download with progress, then a confirmed restart-to-install (the same interruption warning as the shell's native prompt), with the installed client version shown alongside.

## Details

- The row appears only in the shell's own window (`desktopMode` and a `desktop`-via session together, the change-password rule inverted): a browser signed into the same desktop-mode server can neither read the machine's updater state nor restart its GUI app. The server enforces the same pair on the routes.
- New desktop-mode API under `/api/desktop/update` (cookie-authed, unlike the shell's Bearer-token shutdown route): `GET` serves the shell's updater snapshot, `POST /check` and `POST /install` relay commands to the shell. Without a listening shell the commands answer 503 `shell_unreachable`.
- The shell and the embedded server exchange these frames over the existing utilityProcess message port; the window itself remains a plain browser with no preload and no renderer IPC, every capability flowing through the server's HTTP API as before.
- A downloaded build waits undisturbed: automatic re-checks stand down while one is pending (a re-download would invalidate the package on disk under the install button), and transient events — a check flickering by, its network failure — no longer hide the restart-to-install step.
- A row-initiated check reports exactly one outcome as a toast — found (download starts by itself), already downloaded and waiting, already up to date, unsupported, or failed — matching the manual-check contract of the server-update row. Unsupported forms (dev run, non-AppImage Linux install) render the row disabled with the reason as a tooltip.
- The native menu flow (Check for Updates…, its dialogs, the restart prompt on download) was left unchanged.
