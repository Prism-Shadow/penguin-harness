PenguinHarness 0.2.8 — the release where a bound chat channel stops being a text pipe. Pictures and documents travel both ways on Feishu and Telegram, replies arrive as formatted Markdown rather than literal `**bold**`, QQ joins as a third channel you bind by scanning a QR code, and how a run reaches the chat is now three per-binding switches. Alongside that: an extension seam for the harness itself, and terminal sign-in with `penguin auth`.

## Install

**Desktop app**: grab your platform's installer from [penguin.ooo/download](https://penguin.ooo/download) — the page measures both sources on every visit and keeps GitHub unless the OSS mirror is measurably faster, with a manual selector beside the result. The macOS builds are Developer ID signed and notarized and the Windows installers are Authenticode-signed, so neither platform needs a first-launch unblock.

CLI / server (Linux, macOS; bundled Node runtime):

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell):

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

Or via npm (needs Node >= 24):

```sh
npm install -g @prismshadow/penguin-cli
```

## Highlights

**A chat channel carries pictures and files, both ways.** A picture pasted into Feishu or Telegram reaches the Agent as the input the web composer submits — the caption as user text, one `image_url` part per image — and a document reaches it as the composer's other shape: written into the Session scratchpad and handed over as an `[attached file: <path>]` line the model opens with its ordinary file tools, under the same admin-settable caps an authenticated upload answers to, narrowed by any tighter ceiling the channel itself has. Telegram serves a bot no file over 20MB, so that is the number its refusal names. Outbound, a finished run's reply is followed by the files it **mentioned and produced** — path-like tokens that resolve inside the Workspace, exist, and were written at or after the run started. Both filters are load-bearing: the reply's own words are what pick the one output that was the point out of the dozen a run writes, and the mtime is what keeps a steerable reply from becoming a read primitive, since a reply that declines to paste a file still names it. Pictures go as pictures and everything else as attachments, classified by the file the read actually reached rather than by the name the reply spelled.

**Replies arrive as formatting, not as Markdown source.** The bridge sent plain text on every channel, so `## heading` and code fences landed literally. A per-binding `renderMarkdown` now renders each reply in the channel's own markup — Telegram as HTML entities, Feishu as an interactive card's JSON 2.0 rich-text component, QQ as `msg_type: 2` — and the three subsets genuinely differ, so what a channel cannot draw is transformed rather than leaked: Telegram has no headings, lists or tables and gets a bold line, literal markers and a `<pre>` block; QQ has no code spans and gets escaped plain lines. Parsing and chunking are shared, because which constructs a reply contains is a fact about the text and where a long reply may be cut has to be identical everywhere; chunking cuts between blocks, snaps container cuts to line starts so `> ` and `- ` survive, and re-fences a code block that spans the boundary. **A formatted send the platform refuses is retried as plain text**, so a reply is never lost to formatting — the failure Telegram answers with a 400 for one malformed entity.

**Three switches decide how a run reaches the chat.** Each is a per-binding delivery preference, saved beside the credentials and available on all three channels. `linePerMessage` sends each non-blank line of a reply as its own message, capped and paced inside the tightest channel's per-chat allowance, with the remainder combined rather than dropped. `finalReplyOnly` holds a run's working notes and delivers only its last completed assistant text, when the run ends — the answer without the work. `renderMarkdown` is the one above, and the only one that defaults on.

**QQ, bound by scanning a QR code.** A Session's third channel sits behind the same connector seam as the other two, over the platform's WebSocket gateway, so binding one asks for no public callback URL. It did not copy the other two, because QQ does not work like them: every send is a **passive reply** anchored to an inbound message, valid for a few minutes and rationed to a handful per message, so the connector carries a reply budget and combines a run's tail rather than letting the platform drop it. Credentials no longer have to be copied out of the developer console by hand — scan, and the App ID and Secret arrive.

**An extension seam.** An extension package exports one `activate(ctx)` that the server runs once per process while reading `<root>/extensions.json`; everything after that arrives as two typed events, re-delivered on every App creation so a hot swap can never seed registrations into a replaced instance. Which extensions a deployment runs is configuration rather than capability compiled into the platform, and a file that exists but cannot be read fails the boot instead of presenting as a healthy server with every configured capability silently missing.

**Terminal sign-in, and an account bootstrap that stops printing a password.** `penguin auth` signs in from a terminal. A fresh server prints a first-login link instead of a fixed seed password, and a forgotten admin password is recovered offline.

## Notable in this release

- **Breaking — the fixed seed password retires.** A fresh server prints a first-login link; claim the account through it. See [`2026-08-24-penguin-auth`](2026-08-24-penguin-auth.md).
- **Breaking — existing bindings start rendering Markdown.** `renderMarkdown` defaults on, which changes how every relayed message looks. The per-binding switch turns it off. See [`2026-08-27-messaging-markdown`](2026-08-27-messaging-markdown.md).
- **Breaking, on downgrade only.** Two `web.db` changes are one-way in practice; both are stated with what happens and what to do in [`2026-08-26-backward-compatibility`](2026-08-26-backward-compatibility.md) and [`2026-08-27-backward-compatibility`](2026-08-27-backward-compatibility.md).
- **A bot account is no longer owned by one Session forever.** Enabling the connection is the binding; saving credentials never opens or closes one.
- **A binding says what it has actually seen.** "I sent the bot a message and nothing happened" had three different causes and one status word; the panel now separates them, and a Telegram bot that cannot hear a group says so instead of looking healthy and silent.
- **Red-dot to-dos with a way to put them down.** Skill-library updates, model-library preset updates and unexpected errors in the cost center each raise a dot that leads to the control that deals with it. A dismissal stores the signature of what was waved away, so anything new raises it again.
- **A messaging refusal the chat already explained is no longer counted as a defect.** A Feishu scope that has not been granted, and a file QQ structurally cannot carry, are `expected` — the person who can act has already been handed the fix in the chat. A reply that merely *mentions* a file the Workspace does not have is logged rather than announced.
- **LaTeX renders on every Markdown surface**, through one shared pipeline.
- **Scheduled tasks target the current Session by default**, so a task arranged in conversation reports back into it.
- **Deleting the data root clears the browser state that belonged to it** — `localStorage` had no relationship to the data root, so a wipe-and-restart brought the old Workspace back.
- **Qwen 3.8 Flash joins the TokenDance group**, at that gateway's own rates. The same id also sits under Qwen pay-as-you-go at Qwen's direct price: one model reached two ways.
- **CI fans out into parallel shards**, and the community health files GitHub looks for now live under `.github/`.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime; installing from npm needs Node >= 24. All data stays under `~/.penguin/data`.

Full detail: [changelog/0.2.8/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.8).
