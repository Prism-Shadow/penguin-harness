# Backward compatibility

- **Date:** 2026-09-21
- **Type:** process
- **Scope:** `server`, `cli`, `web`, `core`
- **Breaking:** yes — a models PUT, or `penguin config model add`, that writes a model id a first-party vendor group cannot route is refused (`400 model_not_routable` / exit code 1); entries already stored keep working and are never rewritten

[中文版](2026-09-21-backward-compatibility.zh.md)

[A first-party vendor group carries built-in models
only](2026-09-21-vendor-group-presets-only.md) closes a configuration that could be written but
never started. One thing outlives the release: the entries already written that way.

## The old shape: a vendor-group entry with no protocol and an id nothing routes

A `.project_config.toml` may hold a `[[models]]` entry whose `provider` is a first-party vendor
group, whose `client_type` is absent, and whose `model_id` matches none of AgentHub's routing
rules. Such an entry was accepted by the Web App's add dialog and by `penguin config model add`
up to this release. It has never been able to serve a request: AgentHub raises
`<id> is not supported` at client construction.

Chosen: **tolerate it, indefinitely, and mark it.** The models page replaces the whole table on
every save, so refusing a stored row would have made one legacy entry block every later edit of
every other row — the setting a user would go there to fix among them. The refusal therefore
applies only to an entry a request introduces: one already stored under the same
`(provider, model_id)` key passes through untouched, and a key change (a different id, or a move
into a vendor group) is judged as a new entry, because that is the act of writing it there.

**A user is not required to do anything.** The entry stays where it is and keeps failing at
request time exactly as before. The models page marks such a row on its card and offers **move to
a custom group**, which opens the config dialog with the row already moved, where a protocol is
picked or detected — that is the one action that makes the model usable, and it is optional.

## The other old shape: a built-in model saved before its protocol pin

A preset row carries whatever the catalog said when the Project was written. `deepseek-flash` is
the live case: AgentHub routes DeepSeek on the `deepseek-v4` substring, which the released V4.1
Flash id does not carry, so the catalog row pins `client_type = "deepseek-v4"` — and a Project
written before that pin holds `deepseek/deepseek-flash` with no protocol at all. That row is
unroutable by the same rule, and it is the Project's default model.

Nothing refuses it either (it is already stored), and the fix is not a move: **sync presets**
writes the catalog's pin back over the entry. The page tells those two rows apart by whether the
catalog holds that exact `(provider, model_id)` pair and offers the matching action, so a built-in
model is never advised into a custom group. The preset-sync badge already pointed at the same
merge; this only names the consequence on the row itself.

`penguin config model add` follows the same split: naming an entry that already exists updates it,
including one in this shape; naming a new one in a vendor group with an unroutable id is refused
before anything is written.

## Nothing is scheduled for removal

This is a validation rule rather than a shim: there is no second code path reading an old format,
and nothing here expires. The one thing that would change the rule is AgentHub widening its own
routing, which `resolveModelEnv` mirrors — a row that starts routing simply stops being marked.

## Compatibility

Upgrading asks nothing of anyone. Configurations written before this release load and save as they
did; an entry a vendor group cannot route keeps its place in the table and now says so on the page.
What changes is what may be written from here on: a models PUT introducing such an entry answers
`400 model_not_routable`, and `penguin config model add` refuses with exit code 1 — scripts that
add a model of their own to a vendor group move it to a custom group, or pass `--client-type` to
name the protocol it speaks.
