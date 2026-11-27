# Plugin installs show their bytes, stop on silence, and download nothing without asking

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `server`

[中文版](2026-11-26-plugin-install-progress-and-consent.zh.md)

Installing a plugin was bounded by a clock, blind to its own progress, and in places started a download nobody had asked for. A release asset of a few dozen megabytes over a slow link did not finish within the install's fixed window and was killed mid-download; the install stream could not say how far the download had gotten, because npm did the fetching and kept its bytes to itself; and creating an Agent seeded the library's default plugins — a download — unless the caller happened to know to decline it.

## Details

- A release channel's asset (a plugin version published on a github release channel) is downloaded by the server itself now, streamed to disk with the bytes counted as they land: the byte progress the install stream already carries (`download` events with received and total) reports real numbers for the first time. The downloaded file is checked against the sha512 the index entry pins before npm sees any of it, and npm then installs the local tarball from `<prefix>/archives/`, as an uploaded zip's already does.
- The download has no time limit at all — a slow link is slow, not dead. It is cut only when it stops moving: past 30 s without a byte, the address is cut and the next one (a mirror) tried, the same walk as before. A refused address leaves nothing behind; a partial download never reaches the archives.
- The same movement rule replaces the fixed window on the downloads made without npm — the desktop app's server, which has no npm beside it, fetched registry tarballs and release assets under a 120 s absolute window. Registry documents (the small index lookups) keep their absolute windows: there, a dead address should cost one window rather than a hang.
- The absolute window npm runs under on a registry install is a ceiling on npm working, not on a download, and is now 10 minutes: npm fetches its tarball with its own per-request timeouts and retries; what the window catches is a wedged npm, not a slow link.
- An Agent's creation no longer downloads the library's default-install plugins unless the caller asks for them (`defaultPlugins: true`). The web dialog already sent the complete set it showed, so nothing changes there; the CLI takes `--default-plugins` to opt in, where `--no-default-plugins` used to be the way to opt out. A company Agent keeps receiving the plugins its organization hires it with — those are explicit picks, not defaults.
- An organization's recurring pass no longer updates an employee's plugins on its own. It compares each employee's installed company plugins against the library and logs the ones with an update available, shown on the Plugins page; updating is a person's call.
