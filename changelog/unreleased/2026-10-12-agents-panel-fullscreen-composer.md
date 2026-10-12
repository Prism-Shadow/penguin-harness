# At full screen, the agents panel's composer lines up with the subagent's transcript

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1050](https://github.com/Prism-Shadow/penguin-harness/pull/1050)

[中文版](2026-10-12-agents-panel-fullscreen-composer.zh.md)

The agents panel lays the selected subagent's transcript out in the main conversation's reading column, centered and capped at `max-w-3xl`, but its composer spanned the panel's whole width. In a docked panel the two coincided, because the dock is narrower than the column. Once the dock went full screen, the transcript stayed a centered column while the composer stretched across the covered row: 1100px under a 768px column in a 1440px window, 1616px at 1920px. The composer now sits in the transcript's column, as the main conversation's composer does, so a full-screen panel reads like the conversation it covers. A docked panel is unchanged.
