# A reply's link to a Workspace file opens it in the Files panel, and the desktop app stops opening another window for it

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `web`, `desktop`
- **PR:** [#780](https://github.com/Prism-Shadow/penguin-harness/pull/780)

[中文版](2026-09-17-chat-file-links-open-in-files.zh.md)

Clicking a link in an assistant reply that named a file the Agent wrote —
`[pelican-bike.html](pelican-bike.html)` — opened a new browser tab on a Web App route that does not
exist, and in the desktop app opened one more full PenguinHarness window per click. Links in a
conversation are now sorted before they render, and the desktop shell opens a window of its own
only for the addresses that need one.

## Web App

- Inside a conversation — the message stream and the subagent conversations in the agents panel,
  reasoning and compaction summaries included — a relative link, or an absolute path inside the
  Session's Workspace, opens that file in the Files panel the way a file card's row does. The href
  is percent-decoded, a leading `./` is dropped, a query or fragment is ignored, and a `..` that
  leaves the Workspace is refused. A file that does not exist still opens the panel on its path,
  and the panel reports it missing.
- In a conversation, an `#anchor` link (a footnote reference or back-reference) scrolls to its
  target within the page instead of opening a new tab, and a link that names nothing the App can
  open — a path outside the Workspace, a `file:` URL — no longer opens anything.
- External `http(s)` and `mailto` links still open in a new tab, and so does every link outside a
  conversation (Memory, the company handbook, tickets).

## Desktop

- A request for a new window, from the main window or from any window it opened, follows one rule:
  the Workspace HTML preview's "Open in a new tab" route, pages on the preview host and a detached
  terminal get a window of the app; `http(s)` and `mailto` links to anywhere else go to the system
  browser; every other address of the app is refused and logged instead of opening a second copy
  of the App.
- Windows opened from a preview window carry the same rules; they previously carried none.
- A link or navigation with a scheme other than `http`, `https` or `mailto` is no longer handed to
  the operating system.
