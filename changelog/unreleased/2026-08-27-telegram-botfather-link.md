# The Telegram binding's links lead where their labels promise

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `web`

[中文版](2026-08-27-telegram-botfather-link.zh.md)

The Bot Token field's corner link was labelled "open developer console" and pointed at
`core.telegram.org/bots/api`, the Bot API reference. Telegram has no developer console, and
that page does not issue tokens — so a user standing on the one field that needs a token,
following the one link that offers to supply it, landed in an 860KB API manual. The link now
opens `@BotFather`, which is where the token comes from, and says so.

## Details

- `console` for Telegram is `https://t.me/BotFather`. Telegram's own page for it is titled
  "Launch @BotFather" and describes it as the bot "to create new bot accounts and manage your
  existing bots".
- The label follows the target rather than the other way round: this channel uses its own
  `openBotFather` string instead of the shared "open developer console" wording, which stays
  in place for the channels that have one. The label is read at render rather than captured
  in the module-level link table, because `S` is a live binding the locale provider swaps.
- The setup fold's companion link moves from `https://core.telegram.org/bots/tutorial` to
  `https://core.telegram.org/bots/features#botfather`. The former is "From BotFather to
  'Hello World'", which past its token section is about downloading an IDE and picking a
  framework — writing a bot, which nobody doing this is doing. The latter is the BotFather
  guide itself, opening on `/newbot` and the token it returns, which is what the fold's steps
  already say.
- Tests pin both halves: the corner link's target, and that its label and its target name the
  same thing.
