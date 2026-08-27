# The Telegram binding's links lead where their labels promise

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `web`
- **PR:** [#506](https://github.com/Prism-Shadow/penguin-harness/pull/506)

[中文版](2026-08-27-telegram-botfather-link.zh.md)

The Bot Token field's corner link was labelled "open developer console" and pointed at
`core.telegram.org/bots/api`, the Bot API reference. Telegram has no developer console, and
that page does not issue tokens — so a user standing on the one field that needs a token,
following the one link that offers to supply it, landed in an 860KB API manual. The link was
repointed at `@BotFather`, where the token actually comes from, and the label was reworded to
name it.

## Details

- Telegram's corner link was repointed at `https://t.me/BotFather`. Telegram's own page for it
  is titled "Launch @BotFather" and describes it as the bot "to create new bot accounts and
  manage your existing bots".
- The label was made to follow the target rather than the other way round: this channel took
  its own `openBotFather` string instead of the shared "open developer console" wording, which
  stayed in place for the channels that have one.
- The link table's key was renamed `console` → `credentialSource`, and the comments around it
  stopped calling that slot a console — the next channel added to the table reads a name and a
  description that fit a credential issued from a chat as readily as one issued from a page.
- The setup fold's companion link was moved from `https://core.telegram.org/bots/tutorial` to
  `https://core.telegram.org/bots/features#botfather`. The former is "From BotFather to
  'Hello World'", which past its token section is about downloading an IDE and picking a
  framework — writing a bot, which nobody doing this is doing. The latter is the BotFather
  guide itself, opening on `/newbot` and the token it returns, which is what the fold's steps
  already say.
- Tests were extended to pin both halves — the corner link's target, and that its label and
  its target name the same thing, asserted as one anchor — and to run over both dictionaries,
  so the label cannot regress in the locale the suite does not activate.
- The design spec was updated to match ([penguin-harness-design #70](https://github.com/Prism-Shadow/penguin-harness-design/pull/70)).
