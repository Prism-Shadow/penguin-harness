# Backward compatibility: company mode's trial rounds

- **Date:** 2026-09-09
- **Type:** process
- **Scope:** `server`
- **PR:** [#587](https://github.com/Prism-Shadow/penguin-harness/pull/587)

[中文版](2026-09-09-backward-compatibility.zh.md)

[Company mode](2026-09-02-company-mode.md) reached its trial rounds with organizations already
on disk, so five of its later changes had to meet data written before them. None needs a
migration and none asks the user to do anything; this file says what each one tolerates and
which of them is a shim with an expiry.

## `sessions.client = "org"`: stamped on creation, backfilled by reconcile

Desk and ticket sessions are now written with `client = "org"` on their `sessions` row, and
development mode's list hides such rows whether or not the organization still exists or
company mode is on. Sessions that predate the change carry `web`, `cli` or nothing. Every
reconcile pass therefore stamps the rows the organization's files name — `desks.toml`
(current and previous desks) and the tickets' `Sessions` headers — with one idempotent
`UPDATE … WHERE client IS NOT 'org'`, so every existing organization is marked on the next
pass after the upgrade.

What stays unmarked: the sessions of an organization deleted **before** this change. No file
names them any more, so they read as development mode's own until archived or deleted by hand.
Accepted: the alternative was guessing from session titles.

**This is a shim with an expiry.** The backfill costs one cheap statement per reconcile pass
and can be dropped once every install has reconciled on a build that carries it — that is,
from the release after the one that ships it. Whoever bumps the company-mode migrations next
removes the backfill call in `reconcile.ts` (`markOrgClient`) and its test.

## `language` absent from `org_config.toml`

Organizations created before the working-language field have no `language` line. The server
reads the language from the mission at read time (a Han character anywhere → `zh`, else
`en`), so nothing is rewritten and nothing is migrated; the field is written by creation and by
the settings dialog from now on. Not a shim: the fallback is the field's defined default.

## Channel lines without `notice`

System lines written before the structured notice carry only their English `text`. Every
reader falls back to that text when `notice` is absent, and the file format accepts both.
Nothing to remove.

## `ticket_notice` in old Traces

The scheduler no longer produces `kind: ticket_notice` work runs; the marker parser still
accepts the kind so an older Trace's `[org_trigger]` blocks fold and render as before. The
enum member stays for as long as those Traces are read. Nothing to remove on a schedule.

## Ticket files in the format that predates the frontmatter

Tickets are now YAML frontmatter plus prose. Every ticket written before that is
`# Ticket: <title>` followed by `Key: value` header lines, and is still read: `parseLegacyTicket`
in `packages/server/src/organization/files.ts` maps the old headers onto the new fields, folds
`Initiator` into the single `owner` (the filer owns a ticket nobody was assigned) and records it
as the `created` entry of the history, and turns each old progress line
(`- <time> <principal> <text> session:<id>`) into a plain progress sentence plus one `progress`
history entry carrying its time and principal. The board lists both formats side by side, and
every write serializes the new one — so a ticket converts the first time anything writes to it.

What is lost in the conversion: the `moved … → done` progress line an old ticket recorded is a
`progress` history entry, not a `moved` one, so a ticket closed before this change is listed in
the overview's inbox without a `closedAt` — the same way a ticket moved by hand always has been.

**This is a shim with an expiry.** `parseLegacyTicket` can be deleted one release after the
frontmatter format ships, by which time every ticket an organization still writes to has been
converted; a ticket nobody has written to since is a ticket nobody is working on, and its file
can be converted by hand or left where it is. Whoever removes it also drops the legacy branch of
`parseTicket` and the legacy-format test in `organization-files.test.ts`.

## Ticket lines already in the all-hands channel

Ticket changes no longer write a `system` line into a channel, so nothing produces the
`ticket_blocked`, `ticket_done` and `ticket_rejected` notice kinds any more. The three stay in
the `OrgChannelNoticeKind` union and in the Web App's and CLI's renderers, so the lines already
in an organization's message files keep rendering in the reader's language instead of falling
back to raw English. Not a shim on a schedule: they stay for as long as those files are read.

## Compatibility

Upgrading needs no action. Existing organizations are marked on the first reconcile pass after
the restart; organizations deleted before the upgrade leave their sessions in development
mode's list until archived or deleted. Existing tickets are read as they are and rewritten in
the new format the first time they are written to. The two pieces of compat code are the
reconcile backfill and `parseLegacyTicket`, both removable from the next release on.
