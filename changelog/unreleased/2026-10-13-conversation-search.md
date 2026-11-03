# Conversation search: find a conversation by what was said in it

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1108](https://github.com/Prism-Shadow/penguin-harness/pull/1108)

[中文版](2026-10-13-conversation-search.zh.md)

A conversation is remembered by what was in it, not by its title, its Agent or the day it happened. The sidebar can only be browsed by those, so a Session whose title says nothing — every auto-named one — is effectively lost. This adds an index over the Trace tree and the routes to ask it.

## The index

- **`session_search`** is an FTS5 virtual table over each indexed record's text, with the Project, Agent, Session, shard and line carried as `UNINDEXED` columns so a hit opens at the message it matched. The prose is a projection of the record (`indexableProjection`), and `raw` keeps the text the snippet is cut from.
- **`session_search_shards`** is the per-shard ledger: how many bytes of each shard have been consumed, always at a record boundary, so an appended shard continues where the last pass stopped instead of being re-read or half-read.
- The indexer walks the same `<agent>/traces/<yyyy-mm-dd>/<sessionId>_NNN.jsonl` tree the Trace index knows, takes the shards whose size moved, and stops once its budget is spent — so a first search on a large install answers while the rest is still being indexed, and the status route says so.
- The pass runs on a short interval and on every search, so a conversation becomes findable seconds after it is said, without a restart. Deleting a Session, or its Trace files, drops its rows.

## Asking it

`GET /api/projects/:projectId/sessions/search` (Project-level on purpose — nobody remembers which Agent a conversation was under; `agentId` narrows it when the sidebar's grouping is in play):

- `q` is required and capped at 200 characters; `sort` is `recent` (default) or `relevance`.
- Filters: `agentId`, `from` / `to` (real calendar dates, refused rather than silently ignored when malformed), `workspace`, `includeArchived`, `limit` (1–100, default 30) and `offset`.
- Each result carries the Session's list-row facts, how many of its messages matched, whether the match was on the title only, and up to three matched messages — each with the snippet and the matched ranges as offsets into it, so the panel can highlight without re-searching.
- `GET …/sessions/search/status` reports how far the index has got, so a first search can say "still indexing" instead of "nothing found".

**Chinese is searched by substring.** FTS5's tokenizer has no word boundaries to use here, so a query is expanded into single- and two-character phrases (`queryExpression`) — which is what makes a two-character word findable inside a longer run of text.

## Turning the index from something to search into something that answers

- The query text never reaches the read path as a synchronous indexing pass: a search awaits at most a 30 ms catch-up budget, so the box stays responsive while the index trails behind.
- `PRAGMA cache_size = -64000` on open: the default 2 MB page cache is sized for an embedded database, and an install that has been used for a while holds a web.db in the hundreds of megabytes.

## Details

- New on the server: `services/search-text.ts` (projection, query expansion, snippet and mark offsets), `services/trace-record-classify.ts` (what one Trace record is, and whether it opens a turn), `services/session-search.ts` (the indexer and the query), `db/repos/session-search.ts` (the two tables), `http/routes/session-search.ts`, and the `ConversationSearchModule` that wires them.
- Tests: `search-text.test.ts` (projection, expansion, snippet marks), `session-search.test.ts` (end to end over real Trace files: matching, filtering, refusals, incremental indexing, deletion, title-only matches).
