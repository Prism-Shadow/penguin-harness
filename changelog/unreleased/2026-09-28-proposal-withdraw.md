# Company proposals: the author can withdraw a proposal that is still drafting

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[中文版](2026-09-28-proposal-withdraw.zh.md)

An author can take back a proposal of their own that has not been marked ready — `penguin org proposal withdraw <n> [--reason <text>]` — instead of waiting for a person to reject it. The proposal stays on the record under a status of its own, `withdrawn`, apart from a person's `rejected`.

## Details

- `POST …/proposals/:number/withdraw` with `{ reason? }`: the author or a person (403 `not_author` for anyone else, an implementer that is not the author included), and only while the proposal is `drafting` (409 `proposal_status` otherwise, saying that a ready proposal is a person's to reject). A rev-0 draft can be withdrawn.
- The ledger gets one status line (`status: "withdrawn"`, with the reason when given); the timeline shows a `withdrawn` event. Revisions, comments and materials stay; the proposal is still listed and readable.
- A withdrawn proposal is closed like a rejected one: publish (409 `proposal_closed`), implement, discuss, reject, ready and approve are refused.
- The author and the implementer are told on their desks — `withdrawn by <who>[: <reason>] — stop work on it, and close its PR if one is open.` — except whoever withdrew it.
- `penguin org proposal ls --status withdrawn` lists them. On the proposals page a withdrawn proposal is a grey pill, counted under `is:closed` and `is:withdrawn`, not under the default `is:open`; the page has no withdraw button.
- The proposal-author skill says to withdraw a proposal that should not exist rather than rewrite its brief into a notice; the proposal-tester skill treats a withdrawn proposal's branch on `dev` like a rejected one's (agent-company-proposals `2026.09.28.1`).
- A build without this change that reads a ledger with a `withdrawn` line does not skip it: it shows the status as the bare word, with no colour, and does not treat the proposal as closed. Nothing on disk is rewritten.
