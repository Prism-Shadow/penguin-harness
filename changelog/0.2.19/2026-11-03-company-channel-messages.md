# Shorter company channel messages

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `plugins`, `server`
- **PR:** [#1434](https://github.com/Prism-Shadow/penguin-harness/pull/1434)
- **Issue:** [#1394](https://github.com/Prism-Shadow/penguin-harness/issues/1394)

[中文版](2026-11-03-company-channel-messages.zh.md)

Company-mode employees were told how to write a channel message: the point or the question on the first line, at most five short lines after it, and longer content in a document whose path the message names. The `company-employee` and `company-ceo` skills moved to version `2026.11.03.1`, so organizations already on disk pick them up at their next reconcile.

## Details

- `company-employee` gained a "Writing a channel message" section. A message leaves out what the organization's pages already show, does not restate rules, carries no hedging boilerplate, and is not the run's final answer. Multi-line messages go through a quoted heredoc.
- Starting, doing or finishing assigned work and acknowledgements were ruled out as channel messages; a message is posted only when someone else must act on it, and that person is mentioned. A handoff is one line and the ticket, and an employee no longer mentions itself, since such a mention is never delivered.
- The CEO's board proposals and reports put the decision first, with one short line each for the reason, the cost and the alternative. The initialization proposal stays the one long message, with its questions numbered at the top and the plan in short bulleted sections; the report after initialization names only what differed from the proposal and the next decision.
- The handbook written for a new organization carries the same channel etiquette in English and Chinese; the handbooks of existing organizations were left as they are.
