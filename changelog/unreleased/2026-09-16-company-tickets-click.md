# A ticket card opens with a click and moves with a drag, and a ticket session opens

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#752](https://github.com/Prism-Shadow/penguin-harness/pull/752)

[中文版](2026-09-16-company-tickets-click.zh.md)

Company mode's ticket board and ticket dialog changed how they are clicked. A whole ticket card
became the target that opens the ticket, and dragging it moved it between columns, after a long
press on a touch screen. Inside the dialog the parent, the child tickets and the ticket sessions
opened from their titles instead of corner buttons. Clicking a ticket session had landed back on
the board with the dialog closed; it opened the conversation, and the company sidebar listed it in
a new Temporary group.

## Board

- A click, Enter or Space anywhere on a card opened the ticket dialog; the title button inside
  the card went away. The card was the one declared exception to the company pages' rule against
  whole-area click targets.
- A mouse or pen press that moved more than 6 px lifted the card at once, with no hold: the card
  followed the pointer as a ghost and asked to move when released over another column, through the
  same confirmation as before. A press released before moving that far was a click, and a drag did
  not also open the ticket.
- On a touch screen a card lifted only after being held still for 350 ms, and a finger that moved
  before then scrolled the page.
- Holding a lifted card near an edge of the board or the page scrolled it. Escape put a lifted card
  back.
- HTML5 drag-and-drop was replaced by pointer events, so a card could be dragged with a mouse, a
  pen or a finger. The dialog's move control stayed as the way to move a ticket without dragging.

## Ticket dialog

- The parent ticket, each child ticket and each ticket session opened by clicking its title, which
  underlines on hover and names its destination in its tooltip. The jump buttons beside them were
  removed.
- A session the ticket still named but whose record was gone, for example after its Agent was
  deleted, showed as plain text instead of a link.

## Ticket sessions

- Opening a ticket session from the dialog on the board used to return to the board: the dialog
  closed before the router committed the new location, and the board, still mounted, removed
  `?ticket=` from its query against its own location, replacing the conversation's history entry.
  The board stopped writing its query once the browser has left it.
- The opened session went to the top of a collapsible **Temporary** group in the company sidebar,
  below **Desks** and shown only while it listed something. Each row had the employee's avatar, the
  session title, its run mark and a ✕; the collapsed rail showed the entries' avatars after the
  desk avatars.
- An entry stayed until its ✕ removed it, or until **Close all** in the group's header emptied the
  group in one click, with no confirmation; both took entries off the list and left the sessions
  themselves alone. Going elsewhere or reloading the page kept an entry, and a ✕ pressed on the
  session on screen removed only the row. Opening a listed session again moved it to the top.
- The list was kept in the browser's localStorage, per user, Project and organization, with no
  cap. A desk session opened from a ticket was not listed; its desk row already named it.
- The company mode guide described the board's click and drag, the dialog's titles and the
  Temporary group, in both languages.
