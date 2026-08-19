# Removable exited processes, icon-only copy feedback, single-line trace file name

Three details-card / copy UX fixes from issue #312.

## Exited session processes can be removed (Web App & Server)

The session details card's process list keeps entries whose command has already exited
(the "已退出/exited" rows). Those rows now carry a **Remove** button that deletes the
entry from the list; running rows keep their **Stop** button (which kills and removes,
as before) and are deliberately not removable — a bare removal must never
surprise-signal a live process group.

- New endpoint `DELETE /api/sessions/:sessionId/processes/:processId`: 204 removes an
  exited entry, 409 `process_running` while the process still runs (stop it instead),
  404 `process_not_found` when the id is unknown or the runtime is gone. The removal
  reuses the kill path on the dead entry, exactly like `input_command`'s post-exit reap.
- The docs' session endpoint table now lists all three `/processes` routes (the GET and
  the kill POST had been undocumented).

## Copy buttons confirm with the check icon alone (Web App)

After a successful copy, every copy button swaps its copy icon to a check mark for a
moment (the tooltip flips to "已复制/Copied") — the transient "已复制/Copied" **text
label** is gone everywhere (previously shown next to the check on the Session id and
Agent State path rows). The memory tab's and the skill import dialog's "Copy prompt"
buttons move from toast feedback onto the same shared convention (their glyph flips,
their label never changes), and the now-unused toast strings are removed.

## Trace file row shows the single-line file name (Web App)

The details card's Trace file row no longer wraps the full absolute path over several
lines: it shows just the file name on one line. The full path lives in the tooltip and
in a new copy-full-path button beside the name; clicking the name still deep-links into
the Trace browser focused on the session.
