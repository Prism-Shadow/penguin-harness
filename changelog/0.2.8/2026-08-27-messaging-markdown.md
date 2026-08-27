# A relayed reply arrives as formatting, not as Markdown source

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#519](https://github.com/Prism-Shadow/penguin-harness/pull/519)
- **Breaking:** yes — existing bindings start rendering Markdown after the upgrade, which changes how every relayed message looks; the new per-binding switch turns it off

[中文版](2026-08-27-messaging-markdown.zh.md)

The messaging bridge relayed the assistant's reply as plain text on every channel — Telegram
`sendMessage` with no `parse_mode`, Feishu `msg_type: "text"`, QQ `msg_type: 0` — so the model's
Markdown reached the chat as literal `**bold**`, `## heading` and raw code fences. A per-binding
preference, `renderMarkdown`, now renders it in each channel's own markup. It defaults ON: the
previous behaviour is the thing being corrected, so the corrected one is the default.

## Details

- The option is stored as `messaging_bindings.render_markdown`, a column beside `enabled` and the
  other two delivery preferences rather than a key inside `config_json`. `renderMarkdown` joined
  `FeishuBindingInfo` / `TelegramBindingInfo` / `QQBindingInfo` and all three PUT bodies; an
  omitted value keeps the stored one, and a binding created without an opinion starts with it on.
- Reading the reply as Markdown and deciding where a long one may be cut are shared
  (`runtime/messaging/markdown.ts`, beside `media.ts`): which constructs a reply contains is a
  fact about the text, and a cut through a construct costs it on every channel. The parser is
  `remark-parse` + `remark-gfm` over `unified`, the stack `packages/web` already renders Markdown
  with, so a reply reads the same in the transcript and in the chat.
- The render is per channel, because the three platforms accept three different subsets over two
  markups and three escaping rules:
  - **Telegram** (`telegram-html.ts`) sends `parse_mode: "HTML"`. Bold, italic, strikethrough,
    links, inline code, fenced code with a language and blockquotes render. There is no heading,
    list or table tag, so a heading becomes a bold line, list markers become literal text
    (`• `, `1. `, two spaces of indent per level, `☐`/`☑` for task items) and a table becomes a
    `<pre>` block of its rows.
  - **Feishu** (`feishu-card.ts`) sends `msg_type: "interactive"` carrying the JSON 2.0 card's
    `{"tag": "markdown"}` component, which renders headings 1–6, bold, italic, strikethrough,
    inline and fenced code, nested lists, blockquotes, rules, links and tables. The component
    shows at most five data rows per table and four tables, so an over-limit table is emitted as
    a fenced code block instead of losing rows silently.
  - **QQ** (`qq-markdown.ts`) sends `msg_type: 2` free-form markdown, which is open to every bot
    in single and group chats. Headings, bold, italic, strikethrough, lists, blockquotes, rules
    and links render; inline code, fenced code and tables have no syntax at all, so a code block
    arrives as plain escaped lines and a table as its rows.
- Text that merely looks like markup arrives as text on every channel: `5 < 6` and `a & b` are
  entity-escaped for Telegram and Feishu and backslash-escaped for QQ, a `<script>` in a code
  block stays a `<script>` in a code block, and raw HTML the model typed is shown rather than
  forwarded. A link whose scheme a chat cannot open keeps its label and loses only its
  clickability.
- **A formatted send the channel refuses falls back to a plain-text send of the same message.**
  Telegram answers 400 for HTML it will not parse, Feishu and QQ answer with their own refusal
  codes; each connector retries once with the model's own Markdown source, so the setting can
  cost formatting and never a reply. Only a refusal is retried — a timeout or a reset may already
  have delivered, and re-sending it would post the reply twice. On QQ the retry additionally
  spends one more of the four passive replies an inbound message funds, since a repeated
  `(msg_id, msg_seq)` pair is refused rather than deduplicated; a refusal that was not about the
  message body is not retried at all.
- Chunking became format-aware. A reply over `MESSAGING_TEXT_CHUNK_CHARS` is cut between top-level
  blocks, then inside the one block that is itself too long — between a paragraph's inline runs,
  along a blockquote's or a list's own lines — and a fenced code block that spans messages is
  re-opened and re-closed with its language in every piece. `linePerMessage` composes by staying
  literal: each line is converted on its own, so a line that is not a whole construct arrives as
  the text it is.
- `FeishuApiError` and `QQApiError` were added beside the existing `TelegramApiError`, so all
  three adapters distinguish a refusal the platform answered from a request that never completed
  — the distinction the fallback turns on.
- Every step of the bridge's send chain now checks that its entry still holds the Session's
  connection, the way `observe` already did. A run's last messages and the files behind them are
  queued on that chain, and a hard stop drops the entry and closes the database while they are
  still waiting their turn.
- In the binding editor the option is a third `DeliveryOptionRow` below the other two, with its
  own explanation per channel behind the label's "?" — what a channel can show is the whole of
  what the reader needs in order to decide.

## Compatibility

See [backward compatibility](2026-08-27-backward-compatibility.md) for the added column and what
an upgrade and a downgrade do to it.

Every existing binding starts rendering Markdown on the first open of an updated build. Nothing is
asked of the user and nothing is rewritten, but it is a visible change to every relayed message:
a reply that used to arrive as `**bold**` now arrives bold, a heading arrives as a bold line or a
heading depending on the channel, and a code block arrives monospaced on Telegram and Feishu and
as plain lines on QQ. Turning the switch off in the binding editor restores the previous
plain-text relay exactly.
