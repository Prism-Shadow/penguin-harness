# Draft-screen examples: a rhythm game, an investment Copilot, and a scheduled-tasks folder

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `web`
- **PR:** [#399](https://github.com/Prism-Shadow/penguin-harness/pull/399)

[中文版](2026-08-21-draft-examples.zh.md)

The home screen's example catalog grows by five cards and one folder. Build web apps gains a Muse Dash-style rhythm runner; Build and optimize agents gains a conversational investment analyst as its first entry; and a new Create scheduled tasks folder holds three examples that set up real schedules — TOML files under `agent_state/schedule/`, not an invented API.

## The new examples

- **Rhythm runner mini game** (Build web apps, `web-design`) — a two-lane side-scrolling rhythm game in a single HTML file that plays from `file://`: plain, hold and hazard objects, Perfect / Great / Miss judgments with combo and accuracy, two difficulties, and a graded results screen. The brief synthesizes its own track with the Web Audio API (nothing external survives `file://` once CDNs are off the table), generates the chart from the same beat grid as the music, times every judgment off `AudioContext.currentTime`, and ships an offset-calibration screen.
- **Conversational investment analyst** (Build and optimize agents, `penguin-sdk` + `web-design`) — a stock-market Copilot on the Penguin SDK. One data module behind the app's own backend, curl-verified before any code is written; a refresh cycle that starts with the app and keeps the home page's market view current on its own, showing the last-updated time and marking data stale rather than blanking on a failed fetch; per-cycle index, sector and trend analysis; a chat surface that reaches market data through `exec_command` tools instead of memory; and a CLI for single-ticker lookups sharing the same data and analysis modules as the web surface. Every conclusion carries its numbers, timestamp, source URL and indicator, and the whole thing is framed as analysis of public data rather than investment advice.
- **Create scheduled tasks** (new folder, no pinned skills) — three briefs that check for the `{{SCHEDULES}}` section first, read the server's date, weekday and UTC offset from `date`, and write TOML into `<app_data_dir>/agents/<agent_id>/agent_state/schedule/`:
  - *A 9am weekday planning check-in* — five weekly files rather than one daily one, because `period` takes a fixed interval and has no weekday syntax; all five bind to the current Session's `session_id`, so every morning lands in the same conversation as the progress review.
  - *Daily GitHub project digest* — a 24h task with no `session_id`, so each day opens its own Session; the prompt gathers issues, PRs, CI runs and stale items with the gh CLI and ends in P0 / P1 / P2 recommendations, each linked to its issue or PR.
  - *Friday memory review* — a weekly task bound to the current Session, walking the user through the week and writing what they confirm into the user memory directory in the format the Memory section specifies, with that directory's `MEMORY.md` index updated in the same round.

## Layout and tests

- Folders are no longer all the same length (4 / 4 / 3), so opening the schedules folder moves what sits below the block by one row. The registry docstring and the draft view's layout comments now state the rule that actually holds — folders stay within one row of each other — and `example-tasks.test.ts` enforces it.
- The same test now also checks that every folder and example has non-empty copy in both dictionaries, that the three schedule briefs name the real mechanism (`agent_state/schedule/`, `enabled = true`, `start_at`, and no cron syntax), and that the investment brief keeps its not-advice framing.
