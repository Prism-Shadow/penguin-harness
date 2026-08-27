# A messaging binding can relay a run's final reply only

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#512](https://github.com/Prism-Shadow/penguin-harness/pull/512)

[中文版](2026-08-27-messaging-final-reply-only.zh.md)

Every completed assistant message of a run was mirrored to the chat the moment it completed, so
a run that writes working notes between tool calls sent each note as its own message. A
per-binding option now holds those back and delivers the run's LAST completed assistant text
alone, when the run ends — the answer without the work. Off by default, and off is byte-for-byte
the previous behaviour.

## Details

- The option is stored as `messaging_bindings.final_reply_only`, a column beside `enabled` and
  `line_per_message` for the same reason that one is there: `config_json` is the channel's own
  credential document, owned by its connector, while this means the same thing on every channel.
  It is `INTEGER NOT NULL DEFAULT 0`, ALTERed into an existing database on open by the standing
  `ensureColumn` list — the added-column convention described under
  [backward compatibility](2026-08-27-backward-compatibility.md), which needs nothing of the
  user: the default reproduces the delivery every existing binding already had.
- `finalReplyOnly` joined `FeishuBindingInfo` / `TelegramBindingInfo` / `QQBindingInfo` and all
  three PUT bodies, alongside `linePerMessage` and on the same terms — an ordinary form field
  applied on Save, no route of its own, an omitted value keeping the stored one, and a new
  binding starting with it off.
- What is held is one message: each completed assistant text replaces the one the run was
  already holding, and the survivor is delivered on the run's `task_state` → `idle` edge,
  through the same path every relayed message takes. Chunking, the per-line split, the pacing,
  the group's single reply-to and the send chain's ordering are the ones already there.
- A held reply is addressed where its run was ASKED, not where the chat has since moved. The
  chat ref and the message its first chunk quotes are captured on the run's `task_state` →
  `running` edge, because this is the one delivery that leaves at the far end of a run: a second
  person writing in another Telegram forum topic meanwhile would otherwise take delivery of a
  whole answer to a question they never asked, quoted onto their own message. The files that
  follow the held reply go to the same place. A message relayed as it completes is unchanged —
  it goes to the chat the row names then, which is where the conversation actually is.
- The two delivery options compose in one direction: `finalReplyOnly` picks which text is sent
  and `linePerMessage` decides how that one text is split, so a binding with both on sends the
  final reply one message per line.
- The files a run's reply mentions follow the words that actually REACHED THE CHAT. With the
  option on, that is the final message alone: a file named only in a held-back working note has
  nothing in the chat to say why it arrived, and the mention is the whole reason this feature
  knows which output was the point.
- On QQ the option cuts both ways. It spends the least of that platform's passive-reply
  budget a run can spend — one message — but a passive reply is accepted only for a few
  minutes after the inbound message that funds it, and holding the reply until the run ends
  spends that window on the run: a run that outlives it delivers nothing, where the
  every-message relay would have sent whatever completed inside it. That is a different
  outcome rather than a shade of the same one — silence on the other two channels, lost
  output here — so on QQ it is said twice rather than left to these notes: appended to the
  option's explanation, for the reader deciding, and stood under the row as a warning strip
  while the switch is actually on. `linePerMessage` needs no such warning: QQ clamps the split
  to its own budget and the reply still arrives.
- The `approval_request` notice is not an assistant message and is unaffected — a run blocked on
  approval is exactly when the chat has to hear something. The other fixed notices and the test
  message are unaffected for the same reason, compaction output is still skipped before any of
  this, and a connection that joins mid-run still relays nothing from that run.
- A binding that holds a reply and never sees the run end — the process stops, or a state toggle
  or credential save rebuilds the connection mid-run — delivers nothing of what it held. The
  every-message path loses only the remainder of that run.
- In the binding editor the two options close the form as a pair of `Switch` rows, identical on
  all three channels, saved by the existing Save action, each with its explanation behind the
  "?" beside its label. They are ordered as they take effect: which messages are sent, then how
  each one is split.
