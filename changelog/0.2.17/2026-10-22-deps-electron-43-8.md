# Dependencies: Electron 43.8 (11 advisories; Node 24.22, Chromium 150.0.7871.250)

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1292](https://github.com/Prism-Shadow/penguin-harness/pull/1292)

[中文版](2026-10-22-deps-electron-43-8.zh.md)

The desktop shell's Electron moved from 43.2.0 to 43.8.3: the range became `^43.7.6`, which pnpm
resolves to the newest 43.x past its one-day release-age floor. This closed the eleven Dependabot
alerts against Electron 43.2.0. The bundled Node.js moved from 24.18.0 to 24.22.0 and Chromium from
150.0.7871.129 to 150.0.7871.250. The Electron major stayed at 43, so the node-pty binaries the app
stages were not rebuilt.

## Details

- Advisories closed. High: GHSA-qmv3-fv6v-rmhq (a compromised renderer could poison the sandboxed
  preload code cache), GHSA-9qh4-3jw8-366w (`<webview>` could enable Node.js integration in Web
  Workers), GHSA-j84w-jfhq-vhvj (file and HTTP protocol handlers allowed cross-origin reads),
  GHSA-gr2m-v5gq-v685 (windows opened from a sandboxed document did not inherit its sandbox).
  Medium: GHSA-fw47-9c62-h3vw, GHSA-997q-gvvc-jwmx, GHSA-x562-297c-g43g (permission requests
  attributed to the wrong origin or frame), GHSA-2p8c-gr87-2676 (SameSite cookie restrictions
  skipped for windows opened from links). Low: GHSA-h3v5-h239-pg29, GHSA-3qxv-5xgr-q7w9,
  GHSA-98mx-cjp9-gchm.
- Upstream fixes in this range that reach the shell: the embedded server runs as a
  `utilityProcess`, which could drop output written just before the child exited (fixed in 43.7.6)
  and messages sent through `process.parentPort.postMessage()` right before exit (43.8.0);
  `utilityProcess.postMessage()` after the child had exited no longer crashes, and utility processes
  no longer crash at exit on Windows 11 24H2 and later (43.5.0). The updater's `net.fetch` no longer
  fails permanently with `net::ERR_FAILED` after the Network Service process restarts (43.8.0).
- Only the `electron` entries of `pnpm-lock.yaml` changed; electron-builder 26.16.1 and
  electron-updater 6.8.9 stayed.
