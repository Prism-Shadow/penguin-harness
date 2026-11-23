---
name: storage
description: "See how much disk space PenguinHarness's data root uses — by category, by Project and by agent — and which scratchpads, temporary Workspaces and caches could be cleaned up, with `penguin storage`. Use it when the user asks what takes space, why the disk is filling, or what can be deleted. The removal itself is the user's: they confirm it in Settings › Storage."
version: 2026.11.21.1
---

# Storage

`penguin storage` shows what the data root holds, as the server measured it: the same figures as the app's **Settings › Storage** page. A member sees the Projects they can open; an admin the whole data root.

## Before you start

If the user only invoked this skill, ask what they want to know: how much space is used, what uses it, or what could be cleaned up.

## Show the space used

```bash
penguin storage            # the total, each category, each Project and its agents; an admin also gets the server's own entries
penguin storage --refresh  # measure again first, when the user just deleted something or the figures look old
penguin storage --json     # the same as one line of JSON, for arithmetic
```

The command waits for a measurement under way to end. The categories:

| Category | What it holds | Can be cleaned |
| --- | --- | --- |
| Traces | each agent's conversation records | only by deleting the chats |
| Agent State | the agents' configuration, Skills, history and snapshots | no |
| Temporary Workspaces | folders made for chats started without a Workspace | the ones no chat works in |
| Scratchpads | one folder per chat: attachments, plans, hand-off files | a deleted chat's; an idle chat's after warning the user |
| Caches | the agents' tool environments (`shared_env/`), their apps' caches (`app/cache/`) and the server's `.cache/` | yes, they are fetched, installed or made again |
| Logs, Plugins | the server's logs and installed plugin packages | no, they are measured only |

Answer with the few largest categories and Projects, in the units the command prints.

## See what could be cleaned up

```bash
penguin storage clean                    # a dry run: the review, `x` marking what the app ticks
penguin storage clean --older-than 30    # an idle chat is one last active more than 30 days ago (default 7)
```

Tell the user what the review lists and how much the ticked items would free. Mention what removing them costs: an idle chat's scratchpad takes its attached images and the plans a continued chat relies on; a tool environment is installed again the next time an agent needs it.

## Removing

Never remove anything yourself. `penguin storage clean --yes` takes a person's sign-in and refuses yours (`human_required`). Point the user to **Settings › Storage › Clean up temporary files**, where they review and confirm, or to running `penguin storage clean --yes` in their own terminal. To free the space Traces take, they delete chats in **Settings › Storage › Manage chats**.
