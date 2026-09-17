# New chat honours the Project's default Agent, and three pieces of copy say what happens

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `web`, `cli`
- **PR:** [#773](https://github.com/Prism-Shadow/penguin-harness/pull/773)

[中文版](2026-09-17-new-chat-defaults-and-copy.zh.md)

The sidebar's "New chat" always opened its draft on `default_agent`, overriding the Agent chosen
under **Project settings → New chat defaults**. A new chat now starts on the Project's new-chat
defaults. Three pieces of copy that described behaviour the product no longer has were corrected
alongside: the login page's forgotten-password hint, the "+" menu's image description in goal
mode, and `/compact` in the draft page's slash menu.

## New chat

- Every "New chat" entry point — the sidebar's pinned button, its header button and group-header
  "+", the collapsed rail, the chat page's empty state, an Agent card's "New chat" and a plugin's
  quick start — names in route state only what it is about: an Agent group's "+" or an Agent card
  names its Agent, a Workspace group's "+" its path. The pinned "New chat" and the collapsed rail
  stopped naming `default_agent`, and a Workspace group's "+" stopped naming the current Agent.
- A draft with no Agent named by its entry point or its cache starts on `[default_chat].agent_id`
  while that names an Agent of the Project, then `default_agent`, then the first Agent
  (`newChatAgentId`). The Agent picker waits for the Project's defaults instead of first showing
  the last-used Agent, and saving new defaults over an open draft applies the same order.
- Before navigating, these entry points also clear what an earlier draft with no typed text left
  in the new-chat slot, keeping only the model carry-over and staged skills
  (`prepareNewChatDraft`). An abandoned group "+" no longer stands in for the defaults on the next
  "New chat", and an Evaluation Center draft whose prompt was deleted no longer files the next
  ordinary conversation under **Evaluations** as an evaluation run. Typed text is still parked as
  a draft conversation.

## Copy

- The login page's second footer line said `penguin server reset-admin-password` issues a fresh
  initial password. It now says the server's next start prints a new first-login link, and that
  opening it is how a new password is set. The command's own `--help` description in the CLI made the
  same claim and now says the same thing.
- In goal mode, the "+" menu's **Upload image** entry described images as sent as file paths on
  every model. It now reads as it does outside goal mode, since a goal's images ride its first
  message as ordinary image input and only a model without vision receives them as paths.
- The draft page's slash menu stopped listing `/compact`, which did nothing there. The draft
  offers `/goal` and the installed skills.
