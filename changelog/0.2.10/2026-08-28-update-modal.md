# Updating runs through one dialog: confirm, watch the download, restart

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `web`, `server`, `desktop`, `cli`, `docs`
- **PR:** [#540](https://github.com/Prism-Shadow/penguin-harness/pull/540)
- **Breaking:** yes — `POST /api/version/update` answers with the job status instead of blocking until the run is over

[中文版](2026-08-28-update-modal.zh.md)

The two update entries — the "New version available" superscript on the new-chat page's
version line, and the row under System settings in the sidebar user menu — now open the same
update dialog, and the dialog walks the update the way an app updater does: a check, the
release offered with its notes and a **Download and update** button (nothing is fetched
before it is pressed), a progress bar with **Continue in background**, and **Restart and
update** once the release is ready. Before this, the superscript opened the GitHub page, the
server dialog ran the whole install inside one long request with no progress and ended in
"restart the service by hand", and in the desktop app "Check for updates" started the
download on its own.

## Details

- Web: `lib/update-flow.ts` is the one state machine (`unknown` / `checking` / `disabled` /
  `up-to-date` / `available` / `downloading` / `ready` / `restarting` / `error` /
  `unsupported`) over two backends — the server release and the desktop shell's updater — and
  `lib/use-update-flow.ts` owns the actions, the polling and the outcome toasts. The modal
  (`components/account/update-modal.tsx`) and the row (`update-row.tsx`) replace the update
  dialog, the server row, the desktop row and the install confirmation. Closing the dialog
  never cancels: the row keeps the percentage, the avatar dot appears once the release is
  ready, and the outcome toasts. The version line's superscript follows the flow ("New version
  available" / "Downloading update" / "Restart to update") and opens the dialog.
- Server: the self-update became a background job (`services/update-job.ts`) — `POST
  /api/version/update` starts it (or joins a running one) and `GET` reports `phase` and, while
  the installer's `curl --progress-bar` runs, a real `percent`; the finished result stays
  readable until the next start, which is also the retry. New `POST /api/version/restart`
  exits with core's `SERVER_RESTART_EXIT_CODE` (75) after the graceful shutdown when a
  supervisor is there (`PENGUIN_SUPERVISED=1`, published to the platform as the `lifecycle`
  runtime capability), and answers `no_supervisor` otherwise. The desktop relay gained
  `POST /api/desktop/update/download` and the `available` snapshot state.
- CLI: `penguin server` and `penguin web` run the service as a child process and supervise it
  — forwarding the terminal's signals, exiting with its code, and relaunching it on the
  restart code so the relaunch runs the newly installed release (printed as "Restarting the
  service to apply the update…"). A `tsx` dev run cannot be relaunched by plain node and keeps
  running in-process.
- Desktop: the shell no longer downloads on its own. A check ends in the new `available`
  state; the download starts on the page's `download` command or from the native dialog a
  menu-driven check now ends in ("Download" / "Later"), and the native "restart now" prompt
  follows only a download the native dialog started. The fallback-feed retry of a failed
  package download is unchanged.
- Docs: the Web App, CLI and Server API pages describe the dialog, the supervisor and the
  job/restart endpoints.

## Compatibility

- `POST /api/version/update` used to hold the request open for the whole run and answer
  `{status, output, needsRestart}`; it now answers at once with the job status
  (`{state, targetVersion, phase?, percent?, output, result?, …}`), the old shape living on as
  `result`. `GET /api/version/update` is where a client waits. The Web App and the server ship
  together, so no user action is needed; a script calling the old endpoint should poll GET.
- `DesktopUpdaterCommandMessage.action` and `DesktopUpdateStatus.state` are wider (`download`,
  `available`). The shell and the server ship in one package.
- `SessionConfig`-style SDK surfaces are untouched; nothing on disk changed.
