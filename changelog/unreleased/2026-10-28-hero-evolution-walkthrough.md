# Automatic Agent evolution walkthrough on the home page

- **Date:** 2026-10-28
- **Type:** feature
- **Scope:** `landing`, `ui-gallery`, `ui`
- **PR:** [#1375](https://github.com/Prism-Shadow/penguin-harness/pull/1375)

[中文版](2026-10-28-hero-evolution-walkthrough.zh.md)

The first live app frame on the home page automatically typed and sent an Agent optimization request when it entered view. The conversation showed evaluation, a rule change, parallel retesting and the score improvement from 81 to 88.5 through the Web App's existing interface. It then opened Evaluation Center and the Benchmark's score curve. The walkthrough's pacing was shortened by about a quarter.

The window bar offered Pause and Play beside “Open in the gallery.” Pausing held typing, streamed steps and automatic navigation; playback continued from that point with its remaining waits preserved. The control was shared with the AMSP player and appeared only during the automatic walkthrough.

The walkthrough yielded to manual input, preserved the host page's focus and scroll position, and stayed still when reduced motion was requested. Other live frames retained their existing behavior.
