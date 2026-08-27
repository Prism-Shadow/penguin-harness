# A Telegram bot that cannot hear a group now says so

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#499](https://github.com/Prism-Shadow/penguin-harness/pull/499)

[中文版](2026-08-26-telegram-group-privacy.zh.md)

Messages sent to a bound Telegram bot in a group could go unanswered with nothing to show for
it: no error, no status change, no record. The cause is Telegram's **Group Privacy**, which is on
by default for every bot that was not added to its group as an admin. Under it the Bot API
delivers only commands addressed to the bot (`/command@this_bot`), general commands when the bot
was the last bot to speak in the group, inline messages sent via the bot, and replies to its own
messages. A plain sentence — and a plain `@mention` — is never delivered at all, so `getUpdates`
returns nothing and the connection looks perfectly healthy.

PenguinHarness cannot change that setting: it belongs to the bot's owner in @BotFather. What it
can do is stop the failure from being silent.

## The credential test reports it

`getMe` answers `can_read_all_group_messages` ("True, if privacy mode is disabled for the bot",
returned only in `getMe`). The Telegram credential-test response carries it as `groupPrivacy`, and
a successful test whose bot still has privacy on adds a second, separate line saying so — the
credentials really are fine, and the bot really will answer a direct chat.

The field is reported only when the API actually answered the question. A response without it
reports nothing rather than guessing, because sending a user to @BotFather over an absent field
wastes the trip.

## The troubleshooting fold names all three ways out

The binding panel's Telegram troubleshooting fold gains an entry beside the one-program-per-token
one. It names every part of the fix, because any two of them leave the bot just as mute:

- turn Group Privacy off with `/setprivacy` in @BotFather;
- **re-add the bot to groups it is already in** — an existing group does not pick up the change;
- or make the bot a group admin, since admins always receive every message.

## Not shown in the connection status

The status row reports connection health, and a bot with privacy on is connected and working: it
answers direct chats normally. Marking it there would read as a fault on a binding that has none.
