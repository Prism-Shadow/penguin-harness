# Start page: clearer example titles, two reworked game prompts, more room between blocks

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1067](https://github.com/Prism-Shadow/penguin-harness/pull/1067)

[中文版](2026-10-12-start-page-examples-polish.zh.md)

The start page's examples read more plainly, two game prompts asked for different games, and the
page's blocks stood further apart.

## Details

- **Titles.** "Default optimization: improve the decision agent's accuracy" became "Optimize the
  decision agent"; "Import a Benchmark: list the packages in the repository" became "Import the
  GDPevo benchmark"; "A legal agent: upload documents, download reports" became "A legal agent app
  from one sentence"; the English "Build a general-purpose decision agent and its benchmark" became
  "Build a decision agent and its benchmark", which fits its row.
- **Legal agent example.** Its prompt puts the workflow tab on the new legal agent, where the
  example meant it, instead of on the agent building it.
- **Import example.** It now imports GDPevo from
  `packages/penguinharness-benchmark-gdpevo-train` in Prism-Shadow/penguin-harness-benchmark,
  together with its paired test set, through `benchmark-design`, and leaves a Project that already
  has them as it is.
- **Rhythm runner.** The penguin takes a form for each lane: a high note sends it flying, a low
  note puts it on a sled along the ground. The prompt asks for an easy game (sparse notes, generous
  timing, a missed note never ends the run) and suggests instrumental music.
- **Ski game.** The penguin sled game became a Ski Safari-style game: rolling hills with height, a
  launch off each crest, and flips in the air that score on an upright landing.
- **Spacing.** More room between the brand line, the composer and the examples, and taller example
  and folder rows. The page still fits one screen at 1280×800 and 1440×900 with the sidebar open.
