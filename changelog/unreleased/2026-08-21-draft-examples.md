# Draft-screen examples: a rhythm game, an investment Copilot, and a scheduled-tasks folder

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `web`
- **PR:** [#399](https://github.com/Prism-Shadow/penguin-harness/pull/399)

[中文版](2026-08-21-draft-examples.zh.md)

The home screen's example catalog grows by five cards and one folder. Build web apps gains a Muse Dash-style rhythm runner; Build and optimize agents gains a conversational investment analyst as its first entry; and a new Create scheduled tasks folder holds three examples that set up real schedules.

Each of the five is a one- or two-sentence request rather than a full working brief — what to build and the constraints without which the result would be the wrong thing, with the file layouts, field lists and step-by-step headings left for the Agent to work out or ask about.

## The new examples

- **Rhythm runner mini game** (Build web apps, `web-design`) — a Muse Dash-style rhythm runner: the character runs forward on its own, notes travel in with the music, and they are hit on the beat, with audio and visuals kept tightly in sync.
- **Conversational investment analyst** (Build and optimize agents, `penguin-sdk` + `web-design`) — a stock-market Copilot on the Penguin SDK, modelled on perplexity.ai/finance, that pulls live market data every five minutes from startup and lists the strongest-trending stocks and sector comparison on its home page, with the evidence behind every call. Its stock-lookup tool takes a company name rather than only a ticker, and says so when a company has no match or is not listed instead of inventing a quote. Framed as analysis of public data, not investment advice.
- **Create scheduled tasks** (new folder, no pinned skills) — three schedules, each saying when it fires:
  - *A 9am daily planning check-in* — every day at 9am, in the same conversation, planning the day and reviewing yesterday's progress.
  - *Daily GitHub project digest* — every morning, one repo's issues, PRs and CI, ending in recommendations ranked by priority.
  - *Friday memory review* — every Friday evening, in the same conversation, going through what is worth remembering from the week and writing the confirmed items into Memory.

## Layout and tests

- Folders are no longer all the same length (4 / 4 / 3), so opening the schedules folder moves what sits below the block by one row. The registry docstring and the draft view's layout comments now state the rule that actually holds — folders stay within one row of each other — and `example-tasks.test.ts` enforces it.
- The same test now also checks that every folder and example has non-empty copy in both dictionaries, that the five new prompts stay under their length ceiling and keep their core (the rhythm game synced to music; the Copilot's Penguin SDK, refresh-from-startup, home-page trending list and name-resolving lookup tool; each schedule's trigger time and, for two of them, that they run in the current conversation), and that the investment brief keeps its not-advice framing.
