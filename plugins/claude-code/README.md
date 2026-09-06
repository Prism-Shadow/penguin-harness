# Claude Code

Claude Code as a **session surface**: one more entry under "New chat" that opens the Claude Code TUI in the Session's Workspace, inside the chat page.

## What you get

- **A "Claude Code" entry under "New chat."** Pick an Agent and a Workspace on the draft page, optionally type a first prompt, and open. The Session lands in the sidebar like any conversation.
- **The TUI, in the conversation's place.** The chat page shows a terminal running `claude` in that Workspace instead of the message stream and composer. Close the tab, come back, reload — the program keeps running on the server and the page reattaches to it.
- **The same status glyphs.** The row spins while Claude Code is working and shows the unread dot when it has stopped since you last looked.

A Claude Code Session has no model of its own and takes no Tasks; it is Claude Code's conversation, with PenguinHarness around it.

## Requirements

- Claude Code installed on the server, as `claude` on the server's `PATH` — or name the executable with `PENGUIN_CLAUDE_BIN` in the server's environment.
- Sign-in to Claude Code is Claude Code's own: run `claude` once on the server, or let the first Session's terminal walk you through it.

## Install

The plugin ships with every PenguinHarness build but is not installed by default. On the Plugins page, add it to the deployment's installed plugins (it is tagged *built in* there — nothing is downloaded), then restart the server. Or list it by hand in `<data root>/plugins.json`:

```json
{ "plugins": ["@prismshadow/penguin-plugin-claude-code"] }
```

## How the state is read

A terminal cannot say whether the program in it is thinking. This plugin reads output as activity: output within the last moment means *running*, silence past it means *idle*, exit means *idle*. Claude Code redraws continuously while it works and not at all while it waits, which is why the rule holds.

## Development

```sh
pnpm --filter @prismshadow/penguin-plugin-claude-code build   # dist/, the file plugins.json points at
pnpm --filter @prismshadow/penguin-plugin-claude-code test    # the manifest pairing, and the integration test
```

The integration test starts a real server with this plugin through `@prismshadow/penguin-plugin-test`, with a fake `claude` (`test/fake-claude.mjs`) standing in through `PENGUIN_CLAUDE_BIN`. It needs the server and this package built first.
