# Web App: chat navigation — input history, sticky work-group header, conversation outline

Long conversations were hard to move through: recalling a previous request meant retyping it, collapsing a long thinking/tool run meant scrolling all the way back to its header, and reaching a specific exchange meant scrolling past everything in between. Three navigation aids on the chat page address this (#164).

## ArrowUp input history

- With an (effectively) empty composer, ↑ recalls this session's previous inputs newest-first, shell-style; ↓ walks forward again and, past the newest entry, restores the draft that was stashed when navigation began.
- Editing a recalled entry ends navigation immediately; inside a multi-line entry the arrows move the caret line by line first (only ↑ on the first line / ↓ on the last line step the history, zsh-style), and IME candidate navigation is untouched.
- Only text the user actually typed qualifies: handoff / model-switch source blocks, scheduled-trigger prompts, and goal re-sends past round 1 stay out; steering messages are included; consecutive duplicates collapse. Draft chats have no history and keep native arrow behavior.

## Sticky "Reasoning & Tools" header

- The group header now sticks to the top of the message list while its group body is in view, so a long thinking/tool run can be collapsed from anywhere inside it instead of scrolling back to the start.
- Collapsing from the stuck header scrolls the view back onto the group (expanding, and collapsing an in-view group, move nothing). The card clips with `overflow: clip` instead of `overflow: hidden` — a hidden ancestor is a scroll container, which is exactly what disabled `position: sticky`; the sticky offset cancels the stream container's own top padding in the same rem unit, and the dark-mode header background is now opaque so scrolled rows can't bleed through it.

## Conversation outline

- A collapsible quick-jump index docks left of the message stream (≥1280px, conditionally mounted — below the breakpoint no DOM is rendered, keeping hidden copies of message text out of text lookup and assistive tech).
- One entry per exchange: the user's question as a right-aligned mini bubble plus a truncated plain-text preview of the reply (markdown flattened; the newest turn shows a pulsing "answering" note while its reply hasn't started). Protocol banners open no entry, goal rounds merge into the round-1 entry, scheduled turns are listed.
- A scrollspy highlights the exchange at the reading line (the stream bottom counts as the newest turn), the active entry expands accordion-style, and clicking jumps straight to the turn with a brief flash on the landed-on message. The open/collapsed preference persists per device; jump anchors are stamped only on the main conversation and queried scoped to its scroll container, so nested subagent renders can't collide.

## e2e viewport pin

The Playwright suite now runs at 1200×720: the previous default (1280×720) sits exactly on the xl breakpoint where the outline docks, and the outline's previews would have doubled every unscoped text lookup across the historical specs. The new `outline.spec.mjs` opts into 1440×860 and covers the outline, the sticky header, and history recall end to end.
