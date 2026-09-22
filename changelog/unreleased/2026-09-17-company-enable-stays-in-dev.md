# Turning company mode on offers the mode instead of switching to it

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `web`
- **PR:** [#781](https://github.com/Prism-Shadow/penguin-harness/pull/781)

[中文版](2026-09-17-company-enable-stays-in-dev.zh.md)

Turning company mode on — the admin's **System settings → Server → Company mode** switch, or the
user's own switch under **System settings → General** — could put the shell straight into company
mode: the sidebar became the company sidebar while the main area stayed on the page it was showing,
often the new-chat page rather than the company landing. It happened whenever a company choice was
still stored from before the mode became unavailable, and a reload or another tab did the same.
Turning either switch on now only adds **Company** to the work-mode switch. The shell stays in
development mode on the current page, and the user enters company mode from the switch, which
opens the company landing as before.

## Details

- While company mode is unavailable — either switch off — the chosen work mode is development, in
  the Web App's store, the `penguin.workMode` localStorage mirror and the `workMode` preference
  alike. A company choice is written back as development when a switch is turned off in the app,
  when the app loads with a switch already off, and when preferences that hold it arrive while a
  switch is off. The organization last opened is kept, so a later switch to company mode still
  lands on it.
- The work mode becomes company only through the work-mode switch, the collapsed rail's
  company-mode button or an `/org` route, and only while company mode is available.
- Signing in on the login page adopted the user before `/api/me` had been read again, so the shell
  mounted for a moment on the flags from before the sign-in. The user is now adopted together with
  that answer, or on its own when the read fails — except on a 401, which says the session cookie
  never took, and the login page stays put instead of flashing a shell that has no session behind
  it. Signing in keeps a stored company choice.
