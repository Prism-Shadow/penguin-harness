# Backward compatibility

- **Date:** 2026-08-26
- **Type:** process
- **Scope:** `server`
- **PR:** [#490](https://github.com/Prism-Shadow/penguin-harness/pull/490), [#493](https://github.com/Prism-Shadow/penguin-harness/pull/493), [#494](https://github.com/Prism-Shadow/penguin-harness/pull/494)
- **Breaking:** yes — one-way for the database: after two Sessions have saved the same bot account, a build from before this change can no longer open that `web.db`

[中文版](2026-08-26-backward-compatibility.zh.md)

This batch touches three things on an existing `web.db`, all on `messaging_bindings` and all
carried by every database that has opened a build with messaging bindings in it (0.2.5 and
later): the `idx_messaging_account` unique index, and the absence of two added columns,
`last_inbound_message_id` and `line_per_message`. Only the index needs a decision; the two
columns are recorded so a reader looking here for "does my database need anything?" finds every
answer in one place.

## The retired unique account index

The index made `(channel, account_id)` unique across the whole table, which is how a bot account
belonged to one Session forever. With [enabling as the binding](2026-08-26-messaging-bind-by-enable.md),
several Sessions may keep the same account saved and the index would reject the second save. Left
in place it would turn the new behaviour into a SQLite constraint error on an ordinary save.

Chosen: **drop it on open**, one `DROP INDEX IF EXISTS idx_messaging_account` next to the existing
`idx_usage_session` drop in `openDatabase`. `SCHEMA_SQL` creates `idx_messaging_by_account` over
the same two columns in the same open, so the by-account lookup the enable guard performs stays
indexed and no query plan changes. Dropping is safe because an index is derived and never data:
every row survives untouched, and a database that never had the index is unaffected (the statement
is a no-op).

Nothing is asked of the user: the drop is automatic, runs on the first open of an updated build,
and no binding, credential or remembered chat is altered.

## The added inbound watermark column

[The persisted redelivery watermark](2026-08-26-messaging-inbound-watermark.md) adds
`last_inbound_message_id` to `messaging_bindings`. A `web.db` formed by 0.2.7 or earlier has the
table but not the column, and `CREATE TABLE IF NOT EXISTS` never alters a table that already
exists.

Chosen: **ALTER it in on open**, one `ensureColumn(db, "messaging_bindings",
"last_inbound_message_id", "TEXT")` in the list `openDatabase` already keeps for exactly this. The
column is nullable with no default, so every existing binding grandfathers in as `NULL` — the
honest value for a binding whose earlier messages this build never recorded an id for. The first
inbound message after the upgrade fills it, and the duplicate guard covers that binding from then
on.

Nothing is asked of the user, and nothing else about a binding is read or rewritten: credentials,
intent and the remembered chat are untouched.

This half downgrades cleanly. An older build's `SELECT *` simply carries a column it does not map,
and its own writes leave the value where it stood; the duplicate guard reverts to being
process-local, which is what that build always did.

## The one-way half

The drop cannot be undone by an older build. A build from before this change recreates the unique
index as part of its own `SCHEMA_SQL`, and that `CREATE UNIQUE INDEX` fails once duplicate
`(channel, account_id)` rows exist — which they will as soon as a second Session saves the same
bot. `openDatabase` runs the schema before anything else, so the failure is at open: the older
build does not start against that database at all. Downgrading after using the new behaviour
therefore means deleting the duplicate binding rows first, keeping one Session's row per account.
A database on which no account was ever saved twice downgrades with no work.

## How long the tolerance stays

The `DROP INDEX` line is load-bearing for as long as a `web.db` formed by 0.2.5 through 0.2.7 can
still be opened by a current build — in practice indefinitely, at the cost of one no-op statement
per open. It is removed only in a release that is allowed to break existing `web.db` files, and it
should be removed together with the `idx_usage_session` drop that sits beside it, since both are
the same kind of debt.

The `ensureColumn` line for `last_inbound_message_id` has the same lifetime and the same removal
condition as every other entry in that list — it is the standing convention for an added column,
not a tolerance of its own.

## The added `line_per_message` column

[One message per line](2026-08-26-messaging-line-per-message.md) added
`messaging_bindings.line_per_message INTEGER NOT NULL DEFAULT 0`, ALTERed in on open by the
`ensureColumn` list that exists for exactly this. It is purely additive and needs no decision:
the default reproduces the delivery every existing binding already had — one message per reply —
so no binding changes behaviour, nothing is rewritten, and the user does nothing. The `ensureColumn`
entry stays for as long as a `web.db` formed before this release can be opened, on the same terms
as the rest of that list. An older build simply ignores a column it has never heard of.

## Compatibility

No action is required. The first open of an updated build drops the index; bindings, credentials
and remembered chats are untouched, and a user who never saves one bot on two Sessions cannot tell
the difference.

Before downgrading to a build from before this change, neither added column needs attention —
but remove the extra rows if any account is now
saved on more than one Session — otherwise the older server fails to open the database. Check with:

```sql
SELECT channel, account_id, COUNT(*) FROM messaging_bindings
GROUP BY channel, account_id HAVING COUNT(*) > 1;
```
