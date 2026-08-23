# One download-source rule for the installers and the download page

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `tooling`, `landing`, `docs`
- **PR:** [#403](https://github.com/Prism-Shadow/penguin-harness/pull/403), [#406](https://github.com/Prism-Shadow/penguin-harness/pull/406), [#420](https://github.com/Prism-Shadow/penguin-harness/pull/420)

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

Two passes decide, because the two questions have incompatible clocks. Whether a source answers is
a round trip; how fast it is cannot be judged in under a second at any probe size, since the
minimum is 256 KB/s against a 1 MiB probe and the boundary case is therefore a four-second
transfer.

- The buttons wait only on the first pass — capped under one second — and go live knowing nobody
  has been handed a link that will never start. Until then they render without an `href`, dimmed,
  `aria-disabled`, with a spinner in place of the download icon.
- That pass asks GitHub one question over a version-less URL that needs no manifest and no tag: does
  it answer. GitHub is the free source and keeps the download whenever it does, so that path does
  not wait for the mirror pointer at all. The pointer runs on a longer clock of its own, and a late
  arrival still reaches the page rather than being discarded.
- The throughput comparison then runs behind the live page and upgrades the links when the mirror
  turns out to be worth switching to, saying so in the status line while it runs. It also runs when
  GitHub missed the sub-second window, so a distant-but-working GitHub is handed the download back
  rather than written off.
- Nothing is cached. Network conditions change between visits, so every page load measures again.
- Requests are bounded by their own caps as well as by their pass. Response headers and transfer
  body have separate caps, so a source that never answers is settled as unreachable without waiting
  out the transfer.
- Throughput is read from the Resource Timing entry rather than the response body, because GitHub's
  release assets refuse cross-origin reads.

## Docs

- The CLI install pages describe the measured selection and `PENGUIN_DOWNLOAD_SPEED_PROBE=0`, in both languages.
