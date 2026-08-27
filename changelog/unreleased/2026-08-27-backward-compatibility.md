# Backward compatibility

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#507](https://github.com/Prism-Shadow/penguin-harness/pull/507), [#508](https://github.com/Prism-Shadow/penguin-harness/pull/508), [#512](https://github.com/Prism-Shadow/penguin-harness/pull/512)
- **Breaking:** yes — on downgrade only: a Telegram binding whose last message was written in a forum topic sends nothing on a build from before this change until its next inbound message

[中文版](2026-08-27-backward-compatibility.zh.md)

This batch touched four things that outlive a release.
[Scoping browser-persisted UI state to its data root](2026-08-26-install-scoped-local-state.md)
added a file in the data root, `<root>/install-id`, and a `localStorage` entry,
`penguin.installId`;
[a Telegram reply carrying the forum topic it was asked in](2026-08-26-telegram-forum-topics.md)
changed what `messaging_bindings.last_chat_id` means on an existing `web.db`, without adding or
dropping a column or rewriting a row; and
[relaying a run's final reply only](2026-08-27-messaging-final-reply-only.md) added a column,
`messaging_bindings.final_reply_only`. Only the browser side and the `last_chat_id` change needed
a decision; the file, the key and the new column are recorded here too, so a reader looking for
"does my install need anything?" finds every answer in one place.


## The browser that has keys but no recorded id

Every browser upgrading into this release holds the keys and has never recorded an install
id. That is indistinguishable from a browser whose data root was wiped, so the sweep would
have run on the first page load after the update, for everyone.

Chosen: **adopt the current id, sweep nothing.** A first sight records the id and leaves the
store exactly as it found it. Destroying legitimate state on upgrade — every user's draft,
pins, Workspace registry and read markers, on an install nobody had touched — would have been
a far worse defect than the one being fixed.

**Nothing here has to be removed later, and nobody is on the hook to remove it.** The adopt
branch is not a migration shim with an expiry: a browser with no recorded id is also a new
profile, a new machine, a fresh private window and anyone who has cleared their site data.
"First sight adopts" is the permanent rule of the comparison, and it reads the same in every
release after this one.

## What a user has to do, once

The cost of adopting is that state which was **already** stale when this shipped stays stale.
A user who wiped their data root before this release still sees the old Workspace, the old
draft and the old pins, because this release records the current root's id over that state
rather than clearing it.

Clearing it is manual, and there is exactly one way: clear site data for the app's origin in
the browser — in the desktop app, that state lives in Electron's userData directory rather
than in `PENGUIN_HOME`, which is why deleting the data root never reached it. Doing so also
resets the preferences the sweep is careful to keep: theme, language, accent, font scale,
display currency, terminal appearance, sidebar collapse, panel width, grouping/sorting mode,
nav-group collapse and the mid-run send mode.

Wipes from this release onward need none of that: the next page load recognises the new root
and clears the install-scoped keys by itself.

## The new file in the data root

`<root>/install-id` holds one line of printable ASCII and is written once, the first time a
root is used. It is an identity, not a credential: it authorizes nothing, and it is served to
unauthenticated callers on purpose.

It needs no decision. A build from before this change never reads it and never writes it, so
a downgrade ignores the file entirely and an upgrade back picks up the same id. Deleting the
file by hand costs one sweep on the next page load — the root then looks new, which is
exactly what it is claiming to be — and nothing else. A root that cannot be written reports
no identity at all, and an unknown identity sweeps nothing.

## The new `localStorage` key

`penguin.installId` was added alongside the keys the Web App already kept, and it is the one
key the sweep never removes: it is what the comparison reads. Builds from before this change
do not know the key and leave it alone, so a downgrade is invisible in both directions.

## The `last_chat_id` column

The column held a bare chat id, which every channel handed to its own API as-is. It now holds a
string only the channel's connector may read: the Telegram connector writes `<chat id>:<topic id>`
for a message written in a forum topic, and the bare chat id for every other message.

Chosen: **permanent dual-format tolerance.** A row written before this change parses as itself —
no separator means no topic — so nothing has to be migrated, converted or reset, and a binding
that has never seen a forum topic is byte-identical to what it was.

Calling that tolerance and asking how long it stays would be the wrong question. The bare form is
not a legacy encoding: it is the only encoding a chat with no topic has, and every direct chat,
every ordinary group and every forum's General topic writes one on every message. The two-form
parse is the format, so nothing ever stops writing the bare form and nothing ever removes the code
that reads it. `chatRefOf` in `telegram-connector.ts` carries the same note.

## The added `final_reply_only` column

[Relaying a run's final reply only](2026-08-27-messaging-final-reply-only.md) added
`messaging_bindings.final_reply_only INTEGER NOT NULL DEFAULT 0`, ALTERed in on open by the
`ensureColumn` list that exists for exactly this — the same shape `line_per_message` took one
batch earlier. It is purely additive and needs no decision: the default reproduces the delivery
every existing binding already had — every completed assistant message of a run, mirrored as it
completes — so no binding changes behaviour, nothing is rewritten, and the user does nothing. The
`ensureColumn` entry stays for as long as a `web.db` formed before this release can be opened, on
the same terms as the rest of that list.

A downgrade is invisible in both directions. What the column does is done by the bridge, so an
older server ignores a column it has never heard of and relays every message again — the setting
is still on disk, and an upgrade back honours it without the user re-saving anything.

## Compatibility

No action is required on upgrade or on downgrade. The single manual step, for a user who wiped
a data root before this release, is above.

Upgrading asks nothing of the user. The first message after the upgrade rewrites the column as
usual, and until then the stored bare id keeps working exactly as it did.

Downgrading is the leg that shows. A user who upgrades, chats in a forum topic and then rolls back
has `last_chat_id` holding something like `-1004475424385:91`; a build from before this change
passes that to Telegram as the chat id, `Number("-1004475424385:91")` is `NaN`, and the string
goes on the wire, so every reply and every test message fails with `Bad Request: chat not found`.
It repairs itself: the next inbound message on that binding overwrites the column with a bare id.
Sending the bot one message is the whole fix, and clearing the column by hand does the same:

```sql
UPDATE messaging_bindings SET last_chat_id = NULL
WHERE channel = 'telegram' AND last_chat_id LIKE '%:%';
```

No other channel is affected: Feishu chat ids are opaque strings the connector has always passed
through untouched.
