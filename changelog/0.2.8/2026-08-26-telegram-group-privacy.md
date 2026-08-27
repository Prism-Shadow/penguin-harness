# A Telegram bot that cannot hear a group now says so

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#499](https://github.com/Prism-Shadow/penguin-harness/pull/499)

[中文版](2026-08-26-telegram-group-privacy.zh.md)

Messages sent to a bound Telegram bot in a group could go unanswered with nothing to show for it:
no error, no status change, no record. The cause is Telegram's **Group Privacy**, on by default for
every bot, under which the Bot API delivers to a bot that does not administer the group only
commands addressed to it (`/command@this_bot`), general commands when it was the last bot to speak
there, inline messages sent via it, and replies to its own messages. A plain sentence — and a plain
`@mention` — is never delivered at all, so `getUpdates` returns nothing and the connection looks
perfectly healthy. The setting belongs to the bot's owner in @BotFather; this change reports it, in
the credential test and in the binding panel's troubleshooting fold.

## The credential test reports the setting

`getMe` answers `can_read_all_group_messages` ("True, if privacy mode is disabled for the bot",
returned only in `getMe`). The Telegram credential-test response carries it as `groupPrivacy`, and
a successful test whose bot still has Group Privacy on shows a second line beside the success one —
the credentials passed, and the caveat is about group chats only.

That line names the setting, never the outcome in any one group. Group Privacy is account-wide and
Telegram overrides it wherever the bot is an administrator, so the notice says the bot receives no
ordinary message in a group it does not administer. The field is reported only when the API
actually answered the question; a response without it reports nothing rather than guessing.

## The troubleshooting fold names both ways out

The binding panel's Telegram troubleshooting fold gained an entry beside the one-program-per-token
one, holding the remedies in full — the toast points at it rather than spelling them out. It leads
with the one that leaves the group's membership alone:

- make the bot an administrator of the group, since administrators always receive every message;
- or turn Group Privacy off with `/setprivacy` in @BotFather, then remove the bot from the group
  and add it back — a group it is already in does not pick up the change.
