# A search page for conversations, and a link straight to the message that matched

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `web`

[中文版](2026-10-13-conversation-search-page.zh.md)

The server can find a conversation by what was said in it (see `2026-10-13-conversation-search.md`), but nothing in the Web App asked it. This adds the page that does.

## Why a page and not a box in the sidebar

Answering "which conversation was that phrase in" needs a filter bar — which Agent, which Workspace, which month, archived or not — and a result row wide enough to read an excerpt in. The sidebar can offer neither, so every hit would have to be opened before it could be judged. The page shares the sidebar's endpoint, its page size and its pure logic (`lib/session-search.ts`) through one hook (`lib/use-conversation-search.ts`); what is new here is the width, the filters and the deep link.

## The page

- **`/search`** — a page of its own, so a search can be linked to and a refresh keeps it: the query lives in the URL (`?q=`) and the filters are page state, because they are a way of reading this answer rather than a place of its own.
- Each result row carries the Session's title, Agent, Workspace and last-activity stamp, how many of its messages matched, and up to three excerpts with the matched text marked. A title-only match says so rather than showing an empty excerpt.
- While the index is still building the page says so (`index` from the status route), so a first search reads as "still indexing" instead of "nothing found".
- A hit's excerpt is the link: the row opens the conversation, and the line the reader recognized opens it pinned to that moment (`lib/message-jump.ts`, `/chat/<id>?at=…`).

## Details

- New: `features/search/search-page.tsx`, `lib/session-search.ts` (filters, ranges, excerpt and mark segmentation, the search path), `lib/use-conversation-search.ts` (the shared query/paging hook), `lib/message-jump.ts`.
- `api/endpoints.ts` gains `searchSessions`; `module.json` registers the page and `router.tsx` maps it; `strings.ts` / `strings-en.ts` gain the `search` namespace.
- The controls come from `@prismshadow/penguin-ui`, like the rest of the Web App.
