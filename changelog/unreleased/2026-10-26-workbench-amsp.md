# Workbenches follow their agent live over AMSP

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `server`, `web`, `skills`, `docs`
- **PR:** [#1350](https://github.com/Prism-Shadow/penguin-harness/pull/1350)

[中文版](2026-10-26-workbench-amsp.zh.md)

A workbench can now follow the Sessions it starts while the agent works, reading the same AMSP records the chat view reads, instead of only polling for the finished answer. AMSP itself did not change. Starting turns, saving results and every other side effect stay in the workbench's handler, and reading results with `sessionResult` and polling keep working. The design is PRFC-0023 ([penguin-harness-design #391](https://github.com/Prism-Shadow/penguin-harness-design/pull/391)).

## Details

- Pages: the server answering a workbench serves its page SDK at `GET …/workbenches/:id/sdk/workbench.js` and `…/sdk/amsp.js`. A page under `ui/` imports `../sdk/workbench.js` and gets `followSession`, `abortSession`, `apiBase`, `transport` and everything `@prismshadow/amsp` exports. It reads the signed-in user's door, `GET /api/sessions/:id/amsp`, so a workbench on a machine and one under `pnpm dev` follow the same way. This took the place of the `/workbench-sdk/amsp.js` path the AMSP design had named and nothing served. See [workbench pages load the AMSP page SDK from their own server](2026-10-26-workbench-page-sdk.md).
- Server code: `WorkbenchHost.subscribe(sessionId, listener)` hands the listener the Session's records as they are written and returns the function that stops it. Reloading or removing the workbench ends its subscriptions. See [a workbench's handler can follow a Session live](2026-10-26-workbench-host-subscribe.md).
- Look: workbench pages receive the app's theme, accent, fonts and design tokens. `/workbench-ui.css` kept its `--wb-*` variables and `wb-*` classes, now mapped onto the app's tokens, and added the tone colours `--wb-tone-<tone>-{fg,bg,line}` and the `wb-badge` status pill coloured by `data-tone`. See [workbench pages follow the theme](2026-10-26-workbench-theme-tokens.md).
- PenguinHarness Support: while a question runs, its dialog shows the answer as it is written, a plain-language line saying what the agent is doing, and a **Stop** button that asks for confirmation; the question shows as answered as soon as its task ends, and statuses are tone badges. Existing installs receive it as a plugin update. See [PenguinHarness Support shows the answer as it is written](2026-10-26-penguin-support-live.md).
- Skills and docs: the `penguin-plugin` Skill gained a "Follow the Agent live (AMSP)" section, and its `scripts/check.mjs --follow <sessionId>` prints a Session's records as a page receives them, until the main conversation's `task_end`. The `penguin-sdk` Skill says a workbench takes neither of its two ways. The docs cover it under Skills & Plugins › Workbench plugins and Agent API › In a browser.
