# WeChat joins as a fourth messaging channel, bound by scanning a QR code

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `server`, `web`, `docs`

[中文版](2026-08-28-messaging-wechat.zh.md)

A Session gained a fourth channel to bind to: WeChat's official claw bot, behind the same
connector seam the other three already sat behind. Binding it is a QR code scanned in WeChat
and nothing else — there is no console to copy a credential out of, so the scan is not the
convenient path here but the only one. Inbound messages arrive on a long poll, so binding one
asks for no public callback URL, and the channel carries text, images and files in both
directions, which none of the other three manage.

## Details

- The transport landed in `wechat-api.ts`: the request envelope and its headers, the
  `getupdates` long poll with its opaque cursor, the single-item sends, and the CDN media
  path in both directions — a pre-signed upload of AES-128-ECB ciphertext under a per-file
  key, and the matching decrypt on the way in. It went in behind an injectable factory, so
  the tests reach it through fakes rather than the network. The protocol is Tencent's, taken
  from its own MIT-licensed OpenClaw plugin and the independent SDK derived from it; neither
  is a dependency, because both own the process's message loop, carry one account, and render
  their login QR to a terminal.
- The channel policy landed in `wechat-connector.ts`. The poll loop backs off on failure and
  reports once per outage, and its FIRST answer is a drain: an empty cursor means "from the
  beginning", so a binding switched on after a week dark confirms that week rather than
  replaying it as a flood of Tasks.
- **Scan-to-connect is the whole credential form.** `wechat-scan.ts` holds the in-flight
  codes and the platform's poll handles — the thing that turns into a bot token — in memory
  only, scoped to the Session that started them and bounded per Session. The browser is given
  a handle this server mints instead, plus the URL to draw and a status. The flow reports more
  states than QQ's because WeChat has more: scanned-but-unconfirmed, a pairing code shown on
  the phone that is typed into the panel, a code spent on too many wrong digits, and a bot
  already bound here, which ends the flow without being a failure. An IDC redirect switches
  the polling host mid-flow without surfacing as a state of its own.
- The `/wechat` route subtree arrived with the verb set the other channels carry, and two
  differences that follow from having no typed credential: its PUT saves the delivery
  preferences alone and refuses to create a binding (400 `wechat_token_required`), and its
  credential test takes no body at all, probing the stored binding because there is no draft.
  The scanned bot id is the account identity, so the one-Session-per-account rule applies to a
  WeChat bot exactly as it does to a Feishu app.
- **Direct chats only.** The channel has no group inbound: a message addressed to the bot in a
  group never arrives, so the panel states that under the controls rather than leaving it in a
  collapsed fold.
- Media travels both ways. A reply's pictures and attachments are uploaded and arrive as real
  images and files; inbound images, files and videos arrive as lazy handles that are fetched
  only after the bridge has decided the message is worth acting on. A voice message is relayed
  as WeChat's OWN transcription of it, so a spoken question is answered rather than refused; a
  recording the platform could not transcribe reaches the chat as the shared not-supported
  notice.
- `wechat-markdown.ts` renders a reply for a client that reads Markdown itself, so it
  subtracts rather than translates: headings, bold, strikethrough, lists, quotes, rules,
  links, inline code, fenced code and tables are emitted as written — the widest subset of the
  four — while what the client will not show keeps its words and loses its markers (headings
  past the fourth level, emphasis around CJK text, and inline images, which become links).
- The three delivery preferences apply here unchanged, and none of them costs anything
  different on this channel: it has no reply budget and no expiring reply window, so its
  binding type re-declares nothing.
- The binding editor's channel selector gained a fourth option, and WeChat arrived with its
  own scan panel, setup steps, media note and troubleshooting entry in both dictionaries.
- The Session row's messaging action and its dialog are now labelled **Remote control**
  (`远程控制`). Only the label changed; the route, the keys and every identifier are the same.
