# The landing site gets an AMSP page at /amsp

- **Date:** 2026-10-22
- **Type:** feature
- **Scope:** `landing`, `amsp`

[中文版](2026-10-22-amsp-landing-page.zh.md)

penguin.ooo/amsp presents AMSP v2 on one page, in the manner of mmsp.penguin.ooo. The page opens with the protocol's name and claim beside a player that replays a run event by event, then draws the run's three boundaries, tabulates every record and event, lists the two streams, the two doors and the SDK, shows three steps to a first run and links to the reference.

## Details

- **Player.** Three scripted runs in tabs: a tool call, the same call under approval, and a plain answer that continues the first Session. The left pane lists each event as it arrives, with the records the Trace stores on a faint ground. The right pane assembles the run: its messages under their Requests, with each Request's thinking level, then `task_end`'s status, the Request count, the elapsed time and the usage as bars. Replay follows the runs' own timestamps, runs only while the player is on screen, pauses on request, and shows each run finished under reduced motion. A note under the player says the model is a script.
- **Sections.** A drawing of `task_begin … task_end`, `request_begin … request_end` and fragments closing into complete records, with a tool's output completing after its `request_end`; the vocabulary table grouped by envelope `type`; the Session stream and the user stream, the Agent-key and signed-in doors, `AgentClient` and `SessionReader`, and the retirement of v1; curl and TypeScript quickstarts; links to the reference, OmniMessage, the Agent API guide, npm and the source.
- **One place per kind of content.** The vocabulary, the doors and the counts in the hero are in `src/lib/amsp-vocabulary.ts`, the code samples in `src/lib/amsp-quickstart.ts`, and the scripted runs in `src/lib/amsp-demo.ts`, typed on the page's own v2 types until SDK 1.0 ships them.
- **Site.** "AMSP" in the header between Download and Docs and in the footer's Product column. The page loads as its own chunk. Its tab title and description follow the reader's language, and its static shell carries its own title, description and share card (`public/og-amsp.png`, rendered by `node scripts/capture-og-cover.mjs amsp`), so links to it unfurl under its own name. `/amsp/` is in the sitemap.
- **README.** `@prismshadow/amsp`'s README links the page.
