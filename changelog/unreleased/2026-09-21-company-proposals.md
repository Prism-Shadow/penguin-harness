# Company proposals: a person reads one while agents build it

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `plugins`
- **PR:** [#0000](https://github.com/Prism-Shadow/penguin-harness/pull/0000)

[中文版](2026-09-21-company-proposals.zh.md)

Company mode gained a **proposal**: a short, abstract, paragraph-commentable description of a change, written by one employee for a person to read while a second employee builds it. It ships as a plugin pair that is off by default — a module plugin `@prismshadow/penguin-plugin-company-proposals` (`plugins/company-proposals`: the ledger, the routes, the page contribution) and a skills plugin `@penguinharness/agent-company-proposals` (`proposal-author`, `proposal-implementer`, `proposal-tester`; `preinstall: false`). Design: penguin-harness-design [#210](https://github.com/Prism-Shadow/penguin-harness-design/pull/210) (PRFC-0016).

## Details

- A proposal has a number per organization, an author, an optional implementer, the person who delegated it, a `scope` of `<file, optional name pattern>` pairs — the only place a file path appears — and sections (change / purpose / one test) whose every paragraph is a comment anchor. Publishing a revision keeps the ids of unchanged paragraphs, so their comments follow. A body that links to a file is refused.
- States: `drafting` → `ready` → `approved` → `merged`, or `rejected`; a request for changes puts `ready` back to `drafting`. Revisions never change the state.
- A person's comments are pending until they request changes; the batch reaches the author as one `@mention` in the organization's `proposals` channel, which the plugin creates with the first proposal and invites the people involved into. Feedback from the implementation, runtime feedback from the test team, and the approval travel the same way — no new trigger kind.
- `implement` opens an implementation session for a colleague the way a ticket session opens, with the proposal text as its first input; the PR it produces is attached as material (`pr`, `issue`, `branch`, `doc`, `ticket`, `url`).
- Every event is recorded with a sequence number; each person has a read position per proposal, and the events after it are that proposal's unread count.
- The ledger is `<orgDir>/proposals.jsonl`, append-only and replayed at start; read positions are in `server_settings`. Where the body comes from — an issue, an RFC file in the workspace — is the company's choice; the ledger holds what was published.
- The page: one company-mode page contributed by the plugin (`pages.nav: "org"`), with the queue on the left (unread first, then by number) and the proposal on the right — head, materials, scope, sections with a comment gutter, timeline, and the actions **Request changes**, **Approve and request merge**, **Reject**. Its sidebar entry carries the unread total. `proposal:<n>[#<pattern>]` in any Markdown surface renders as a capsule with the title and the unread count.
- CLI: `penguin org proposal ls | show | create | publish | ready | implement | material add | feedback | comments | resolve | merged | approve | reject`. An organization without the plugin answers a plain 404, which the CLI reports as the plugin being missing.
- Platform seams the plugin builds on: an `OrgGateway` exported to plugins (read an organization, attribute a write, ensure a channel and speak in it, open an employee's session, notify the Project), a generic `plugin` server event, the `org` value of a contributed page's `nav`, and the proposal DTOs in the server's API types.
