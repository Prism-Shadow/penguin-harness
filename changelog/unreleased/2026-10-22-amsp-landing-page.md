# The landing site gets an AMSP page at /amsp

- **Date:** 2026-10-22
- **Type:** feature
- **Scope:** `landing`
- **PR:** [#1297](https://github.com/Prism-Shadow/penguin-harness/pull/1297)

[中文版](2026-10-22-amsp-landing-page.zh.md)

penguin.ooo/amsp presents AMSP, a PenguinHarness agent's Session stream, on one page in the manner of mmsp.penguin.ooo. The page opens with the AMSP mark, the protocol's name and claim beside a player that replays a run step by step, then charts a run's message structure, documents every record field by field, shows how to run an agent and links to the reference.

## Details

- **Mark.** An AMSP mark drawn as MMSP's sibling: the same four tiles, colours and letter weight, with the blue on the other diagonal. It heads the hero and the share card.
- **Player.** Three scripted runs on one Session in tabs: the first request, a follow-up that continues it, and a follow-up the caller interrupts, whose reply streams as fragments and gets no complete record. The runs keep the timings of a real agent run (the first token after a second or more, a few seconds of thinking, a `date` call of a fifth of a second), and each message shows one `delta`, so every step of a run is on screen at once, one line each: the opening `ping`, the records (the ones the Trace stores on a faint ground), the caller's abort request, and `[DONE]`. The right pane assembles the run: the agent and, on a first request, the model; the messages under their Requests, with each Request's thinking level; then the result read from the records the way the SDK's `RunResult` reads it, with the Request count, elapsed time and usage bars. Replay follows the runs' own timestamps, faster than real time, runs only while the player is on screen, pauses on request, and shows each run finished under reduced motion.
- **Sections.** A bar chart of the message structure on one time axis, longest first: the Task (`task_begin … task_end`), its Requests (`request_begin … request_end`) and their messages (`partial_*` fragments, then the complete record), drawn from the first-request run, with a tool's output completing after its `request_end`; a record reference: the envelope, every kind of record in its family and the control frames (`ping`, `resync_required`, `data: [DONE]`), one at a time, each with an example holding every field and a table of its fields (type, required or optional, meaning, example value), nested ones included; how to run an agent against `/api/amsp/v1`, TypeScript with `@prismshadow/amsp` first (`stream()` for the records, `run()` for the result) and curl beside it, with the hero's button that copies the prompt for a coding agent; links to the reference, AMSP records, the Agent API guide, npm and the source.
- **One place per kind of content.** The families of records and the control frames are in `src/lib/amsp-vocabulary.ts`, the record reference's examples and fields in `src/lib/amsp-records.ts`, the code samples in `src/lib/amsp-quickstart.ts`, and the scripted runs in `src/lib/amsp-demo.ts`, typed on the page's own protocol types until a released SDK ships them.
- **Site.** "AMSP" in the header between Download and Docs and in the footer's Product column. The page loads as its own chunk. Its tab title and description follow the reader's language, and its static shell carries its own title, description and share card (`public/og-amsp.png`, rendered by `node scripts/capture-og-cover.mjs amsp`), so links to it unfurl under its own name. `/amsp/` is in the sitemap.
