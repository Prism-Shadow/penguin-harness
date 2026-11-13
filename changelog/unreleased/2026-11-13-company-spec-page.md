# The landing site gets a draft spec for the next company mode at /company

- **Date:** 2026-11-13
- **Type:** feature
- **Scope:** `landing`

[中文版](2026-11-13-company-spec-page.zh.md)

penguin.ooo/company is a draft spec for the next company mode, on one page in the shape of /amsp. It says what the mode is: a person talks to one lead agent, work is kept as tickets, each ticket is done by a work session of its own, and a ticket reaches the person only to be accepted, answered or reviewed. The shipped company mode is unchanged, and the page links to its docs. The page has no entry in the navigation or the footer; it is reached by its address.

## Details

- **Player.** The hero replays one scripted day of one inbox in three runs: a patrol that proposes two tickets, a request that stops on one question, and a delivery. Each run starts from the inbox the one before it left. The left pane lists the events (the time, who acted, what they did); an event that leaves a ticket waiting on the person sits on an amber ground. The right pane holds the person's inbox, with what waits first, and the file of the run's ticket: its path, whose directory is its status, and the fields the run writes.
- **Sections.** The three roles (the person, the lead agent, the work session), each with what it does and the one thing it never does, and what moves behind the ticket (employees, channels, the handbook, the org chart). One ticket's life as a bar chart on one time axis: the stretches it waits on the person, the stretches an agent has it, the work sessions, and the person's three acts. The ticket file field by field: an example, then the frontmatter, the sections and the per-person triage, each field with its type, who writes it, and whether the shipped format has it. The rules the server enforces, numbered, each with the answer a refused write gets and whether it is enforced today. The setup in four steps, and links to the docs it builds on.
- **What the spec adds to the ticket.** Three frontmatter fields (`source`, `ask`, `deliverables`), a `## Decisions` section, and three per-person triage values kept outside the file (`unread`, `snoozed_until`, `archived`). The five statuses stay. "Waiting on a person" is read from them: `proposed`, `review`, or `in_progress` with a person in `blocked_by`.
- **One place per kind of content.** The statuses, the waiting rule, the inbox order, the fields and the rules are in `src/lib/company-spec.ts`; the scripted day and the charted ticket life are in `src/lib/company-demo.ts`, held to the spec's rules by `test/company-demo.test.ts`.
- **Shared replay frame.** The tabs, the timer, the pause control and the reduced-motion behaviour of the AMSP player moved into `src/components/replay-frame.tsx`, which both players use. The AMSP player plays as before; its tab labels no longer wrap.
- **Site.** The page is its own chunk, loaded on demand. Its tab title and description follow the reader's language; its static shell carries its own title and description with the site's share card. `/company/` is in the sitemap.
