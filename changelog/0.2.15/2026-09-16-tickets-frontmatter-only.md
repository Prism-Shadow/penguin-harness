# Tickets are read in the frontmatter format only

- **Date:** 2026-09-16
- **Type:** refactor
- **Scope:** `server`, `skills`
- **PR:** [#754](https://github.com/Prism-Shadow/penguin-harness/pull/754)
- **Breaking:** yes — a ticket file still in the `# Ticket:` header format is reported as invalid instead of being read

[中文版](2026-09-16-tickets-frontmatter-only.zh.md)

Company mode's tickets have one format on disk: YAML frontmatter followed by the prose
sections. The reader for the format before it — a `# Ticket: <title>` line followed by
`Key: value` headers — was removed on the schedule set in
[backward compatibility](../0.2.13/2026-09-09-backward-compatibility.md). A ticket file that does
not open with `---` now fails to parse with ``the file must start with `---` (YAML frontmatter)``.

## Details

- `parseLegacyTicket`, its header and progress-line helpers, the older ticket-id pattern it
  accepted in `Parent` and `Blocked-by`, and the server's `splitPrincipalList`, which only it used,
  were deleted from `packages/server/src/organization/`.
- The `company-employee` skill stopped naming the old headers: `penguin org ticket block` is
  described as writing `blocked` / `blocked_by`, and the skill and the handbook a new organization
  is created with say "ticket fields" where they said "ticket headers". The `agent-company` plugin
  version moved to `2026.09.17.1`.

## Compatibility

Affected: a ticket written in the header format by a build before 0.2.13 and never written to
since — 0.2.13 rewrote every ticket in the frontmatter format on its first write. Such a file is
left on disk untouched and is handled like any other ticket file that does not parse:

- The board shows it only under "Ticket files that failed to parse", with its path and the error;
  `penguin org ticket ls` prints it as an `invalid` row (`invalidFiles` under `--json`), and the
  reconcile pass records an `org_ticket_invalid` error.
- Opening it answers 404 `ticket_not_found`; every write to it is refused with 409
  `ticket_invalid` (400 `bad_request` on read and write alike when its slug still carries a
  digit or is otherwise not letters-only), so nothing converts or overwrites it. A new ticket that
  would take its id gets the next suffix.
- Until it is repaired, the sessions only it names count toward no ticket and no employee's spend,
  and a ticket whose `parent` names it is flagged for a missing parent.

To recover a ticket whose slug is letters-only, write to it once through 0.2.13 (a progress line
or a move converts it), or convert it by hand with the mapping below. The 0.2.13 write path helps
no other ticket, because 0.2.13's routes already answered any other id with 400; recover such a
ticket by hand, in three steps:

1. Rename the file, in the directory it sits in, to an id with a letters-only slug: keep the
   `<yyyy-mm-dd>-` prefix, write the slug as lowercase English words joined by hyphens, and add a
   letter suffix (`-b`, `-c`, …) when that id is taken.
2. Replace the title line and headers with a frontmatter block, following the mapping below.
3. Wherever another ticket's `parent` or `blocked_by` names the old id — `Parent` or `Blocked-by`
   in a file still in the header format — write the new id instead.

The mapping from the headers to the frontmatter:

- `# Ticket: <title>` → `title`; `Status` → `status` (it must match the column directory).
- `Owner` → `owner`, or the `Initiator` value when `Owner` is empty.
- `Initiator` → the first `history` entry: `{at: <time of the first progress line>, by: <initiator>, action: created}`.
- `Notify: a, b` and `Sessions: a, b` → the lists `notify: [a, b]` and `sessions: [a, b]`.
- `Parent`, `Priority`, `Due`, `Blocked` → `parent`, `priority`, `due`, `blocked`; `Blocked-by` →
  `blocked_by`. A ticket id there needs a letters-only slug: a renamed ticket's new id.
- Any other `Key: value` header → a field of the same name.
- Each `## Progress` line `- <time> <principal> <text> session:<id>` → `- <text>`, plus a
  `history` entry `{at: <time>, by: <principal>, action: progress, note: <text>}`.
