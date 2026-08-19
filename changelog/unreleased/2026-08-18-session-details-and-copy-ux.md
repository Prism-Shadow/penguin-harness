# Removable exited processes, icon-only copy feedback, single-line Trace file row

- **Date:** 2026-08-18
- **Type:** fix
- **Scope:** `web`, `server`, `docs`
- **PR:** [#327](https://github.com/Prism-Shadow/penguin-harness/pull/327)
- **Issue:** [#312](https://github.com/Prism-Shadow/penguin-harness/issues/312)

[中文版](2026-08-18-session-details-and-copy-ux.zh.md)

Three fixes to the chat session's details card and the copy affordances around it: exited background processes became removable from the process list, copy buttons confirm with their icon alone, and the Trace file row shows a single-line file name.

## Removable exited processes

The details card's process list keeps entries whose command has already exited. Those rows gained a **Remove** button that deletes the entry; running rows kept their **Stop** button, which kills and removes as before, and were deliberately left non-removable.

- Added `DELETE /api/sessions/:sessionId/processes/:processId`: 204 removes an exited entry, 409 `process_running` while the process is still running (stop it instead), 404 `process_not_found` when the id is unknown or the runtime is gone. The removal reuses the kill path on the dead entry, like `input_command`'s post-exit reap.
- Removal is immediate and final: the entry leaves the runtime registry together with the output captured from that process, so `input_command` on that `process_id` afterwards reports an unknown `process_id`. No confirmation step was added — the button's tooltip and the Web App docs state what the row takes with it.
- The docs' session endpoint table gained rows for all three `/processes` routes; the GET and the kill POST had been undocumented.

## Copy buttons confirm with the check icon alone

After a successful copy, every copy button swaps its copy icon to a check mark for a moment and flips its tooltip to "Copied". The transient "Copied" **text label** was dropped everywhere — it had sat next to the check on the Session id and Agent State path rows. The memory tab's and the skill import dialog's "Copy prompt" buttons moved off toast feedback and onto that shared convention, flipping their glyph while their visible label stays put; the toast strings they had used were removed.

- An icon swap is silent, so every copy control also renders a visually hidden polite live region that announces the confirmation to screen readers. The accessible name stays the copy action.
- Repeated clicks each get the full flash window: the pending reset is restarted rather than left over from the previous click. A control that unmounts inside that window — the Trace row closes the details card itself — no longer leaves a timer behind.

## Trace file row shows the single-line file name

The details card's Trace file row stopped wrapping the full absolute path over several lines and shows just the file name on one line. The full path moved into the tooltip and into a new copy-full-path button beside the name; clicking the name still deep-links into the Trace browser focused on the session.
