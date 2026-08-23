# One download-source rule for the installers and the download page

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `tooling`, `landing`, `docs`
- **PR:** [#403](https://github.com/Prism-Shadow/penguin-harness/pull/403), [#406](https://github.com/Prism-Shadow/penguin-harness/pull/406)

[中文版](2026-08-23-download-source-rule.zh.md)

`install.sh`, `install.ps1` and the desktop download page each chose between GitHub and the OSS
mirror their own way. They now apply one rule, measured rather than assumed: time the release's
large probe file on GitHub, keep GitHub whenever it reaches 256 KB/s, and only below that measure
the mirror and switch to it when it is more than 1.5x faster. GitHub is the free source, so it
keeps every tie and every comparison that cannot be measured, and the mirror's bandwidth is never
spent on a probe that could not change the answer. `penguin update` inherits the rule through
`install.sh`.

## Installers

- Auto mode no longer hands a bundle under 32 MiB straight to the mirror without measuring anything; every auto install is decided by the same measurement.
- A GitHub below the minimum no longer means the mirror by default. The mirror is measured too, and has to beat GitHub by the switch ratio to take over.
- The probe budget covers the manifest, the reachability pair and up to two throughput probes, and is the sum of their caps, so the second throughput probe always gets its full window.
- Progress output names which of the two conditions decided it.

## Download page

- The buttons wait for the answer behind a spinner instead of pointing at GitHub while the probe runs, so a visitor who cannot reach GitHub is never handed a link that will not start. Whatever the probe decides, the source can still be switched by hand.
- Every request is bounded by its own cap and by a 9s budget over the whole sequence. Response headers and transfer body have separate caps, so a source that never answers is settled as unreachable without waiting out the transfer.
- An unreachable GitHub is settled on whether the mirror answers, asked with the 64 KiB probe; a reachable one below the minimum is settled on throughput, measured on the large probe.
- The result is cached for the browser session, so the measurement happens at most once per tab.
- Throughput is read from the Resource Timing entry rather than the response body, because GitHub's release assets refuse cross-origin reads.

## Docs

- The CLI install pages describe the measured selection and `PENGUIN_DOWNLOAD_SPEED_PROBE=0`, in both languages.
