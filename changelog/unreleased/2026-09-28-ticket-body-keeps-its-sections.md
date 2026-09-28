# Company mode: a ticket created from a whole body keeps its acceptance criteria

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `server`, `cli`, `docs`

[中文版](2026-09-28-ticket-body-keeps-its-sections.zh.md)

`penguin org ticket create --body-file <path>` (the `body` of `POST /:orgId/tickets`) put the whole file into the goal and left the acceptance criteria empty. A file that opened with `## Goal` and carried `## Acceptance criteria` was written with those headings twice, the criteria sat under the second copy inside the goal, and `ticket show` reported no criteria at all. The body's sections are now the ticket's.

## Details

- The server reads `body` with the parser it reads a stored ticket file with: `## Goal`, `## Acceptance criteria`, `## Progress` and `## Result` fill the matching fields, and any other `##` section is kept as written.
- Text above the first `##` heading (an `# H1` title, say) is a 400 that quotes the line, and no ticket is written.
- A body with no `##` heading at all is plain prose and stays the goal, as before.
- The `--body-file` help text (English and Chinese), the CLI reference and the server API reference describe these rules.
- Tickets already on disk are not touched. One filed the old way still has the duplicated headings; editing its file by hand to keep one copy of each makes the criteria readable again.
