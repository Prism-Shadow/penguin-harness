# Web App: chat navigation — input history, stacked sticky headers, minimap tick rail

Long conversations were hard to move through: recalling a previous request meant retyping it, collapsing a long thinking/tool run meant scrolling all the way back to its header, and reaching a specific exchange meant scrolling past everything in between. Three navigation aids on the chat page address this (#164).

## ArrowUp input history

- With an (effectively) empty composer, ↑ recalls this session's previous inputs newest-first, shell-style; ↓ walks forward again and, past the newest entry, restores the draft that was stashed when navigation began.
- Editing a recalled entry ends navigation immediately; inside a multi-line entry the arrows move the caret line by line first (only ↑ on the first line / ↓ on the last line step the history, zsh-style), and IME candidate navigation is untouched.
- Only text the user actually typed qualifies: handoff / model-switch source blocks, scheduled-trigger prompts, and goal re-sends past round 1 stay out; steering messages are included; consecutive duplicates collapse. Draft chats have no history and keep native arrow behavior.

## Sticky "Reasoning & Tools" headers, stacked by level

- The group header sticks to the top of the message list while its group body is in view, and the currently scrolled thinking/tool row pins right below it — rows push each other out at their section boundaries, so the bar directly above the content is always the section being read, never a skipped level. A long run can be collapsed from anywhere inside it, per section or as a whole.
- Collapsing from a stuck header scrolls the view back onto that group/row (expanding, and collapsing in view, move nothing). The card clips with `overflow: clip` instead of `overflow: hidden` — a hidden ancestor is a scroll container, which is exactly what disabled `position: sticky`; the group offset cancels the stream container's own top padding in the same rem unit (the rows' offset adds the header's height on top), and the stuck bars' backgrounds are opaque so scrolled content can't bleed through.

## Conversation minimap (tick rail)

- The quick-jump index costs the conversation no width: a tick rail overlays the left gutter the centered column leaves free — one tick per exchange (pitch compresses as turns grow), the reading position longer and darker, tracked by a scrollspy (the stream bottom counts as the newest turn).
- Hovering or focusing a tick pops a floating preview card — the user's question in bold over a truncated plain-text reply preview (markdown flattened; the newest turn shows a pulsing "answering" note while its reply hasn't started) — and clicking jumps straight to the turn with a brief flash on the landed-on message. The card is a pure tooltip: hit-transparent and mounted only while hovering, so message text is never duplicated into the DOM at rest.
- When the rail cannot show at all — phones without a hover pointer, or any window whose gutter a docked panel ate — the index moves to a top-right toolbar icon button opening a dropdown of the exchanges (question + truncated reply, reading position highlighted, tap to jump), so navigation stays reachable in every layout. Active-entry resolution counts only anchors that are outline entries: banner-only messages, merged image fragments and goal rounds past 1 resolve to the entry covering them instead of clearing the highlight.
- The toolbar's agents-panel button drops its label below sm like the workspace button next to it (icon with title/aria only) — the text ate the session title's room on phones.
- The rail renders only while the measured gutter actually has the room (live measurement — opening a docked side panel hides it, closing brings it back) on hover-capable pointers; the overlay itself takes no pointer events, so the wheel keeps scrolling the stream anywhere in the gutter. Protocol banners open no entry, goal rounds merge into the round-1 entry, scheduled turns are listed; jump anchors are stamped only on the main conversation and queried scoped to its scroll container, so nested subagent renders can't collide.

## e2e

The new `outline.spec.mjs` covers the tick rail (hover card, jump, panel-eats-gutter auto-hide), the stacked sticky headers, and history recall end to end at 1440×860; the suite keeps Playwright's default viewport — the rail duplicates no text at rest, so the historical specs needed no changes.
