# Backward compatibility

- **Date:** 2026-09-02
- **Type:** process
- **Scope:** `server`, `core`, `web`, `cli`
- **PR:** [#542](https://github.com/Prism-Shadow/penguin-harness/pull/542)
- **Breaking:** yes — the first restart-only schema migration: a hot push of this version onto a running runtime is refused until the runtime is restarted; goal mode on an Agent from before this release answers 409 until the `goal` plugin is installed on it

[中文版](2026-09-02-backward-compatibility.zh.md)

[Hooks in core, goal mode and continual learning as plugins, and the skill library becomes a
plugin library](2026-08-29-stop-hook-goal-mode.md) touches six things that outlive a release:
the `goal_state` table every `web.db` has carried since 0.1.3, the hook packages an existing
Agent does not have, the versions and icons of skills installed from the old library, the
`goal_finished` records and `[goal]` rounds in old Traces, the `@prismshadow/penguin-skills`
package, and the `skills` field / `--skills` flag of Agent creation. Only the table needed a
decision; the rest is recorded here too, so a reader asking "does my install need anything?"
finds every answer in one place.

## The `goal_state` table: dropped by migration 3, the first restart-only one

Every `web.db` created since 0.1.3 has `goal_state` (one row per goal run: objective, status,
budget, used, rounds) and its index `idx_goal_session`. The rows were read back for one thing —
restoring the chat page's goal banner after a reload — and this release reads the goal plugin's
`GOAL.json` in the Session scratchpad for that instead. Nothing writes the table any more, and
a fresh database is created without it.

Chosen: **drop it, by an ordered migration** — `drop-goal-state`, version 3 in
`db/migrations.ts` — rather than leave a dead table behind that fresh and upgraded databases
would disagree about forever. The migration runs once at the runtime's own open
(`openDatabase`), stamps `PRAGMA user_version = 3`, and is idempotent (`IF EXISTS`) for a
database this build created. Its `down` recreates the table exactly as 0.2.9 declared it,
**empty**: the dropped rows are gone for good, and what they fed — the banner of a goal that
already ended — is the one thing that does not come back.

It is `swapSafe: false`, the first migration that is. A hot-pushed platform boots against the
live database and is rolled back to its predecessor if the boot fails; a predecessor that found
`goal_state` gone mid-process would prepare its goal statements against nothing, and its own
declarative track only runs at a full open. So the push is refused whole, before any DDL runs,
with `RestartRequiredError` naming this migration: the current platform keeps running, and a
restart of the server (or of the desktop app) applies the migration at open. That is the whole
of what a user does, once — and only a user who hot-pushes; an installer or a package update
restarts anyway.

Downgrading to 0.2.9 works: its `openDatabase` re-declares the table (`CREATE TABLE IF NOT
EXISTS`) and finds nothing to migrate, so goal mode runs and only the history of earlier goals
is missing from the banner. An operator who needs the table back on this build has
`rollbackTo(2)`.

**Nothing here is removed later, and nobody is on the hook to remove it.** A migration is
permanent by the mechanism's own rule — versions are never renumbered or rewritten once
released — and the `IF EXISTS` is not a shim: it is what lets the migration be the same
statement on a database created by this build.

## Existing Agents have no hook packages

Hook packages are new; an Agent that exists today has an empty `agent_state/hooks/`, and nothing
installs into an existing Agent at boot (the decision this batch recorded: install policy
follows creation, an existing Agent is never rewritten). Goal mode on such an Agent answers
`409 goal_plugin_not_installed` — the Web App says so and points at the plugin library — until
`goal` is installed there, one click per Agent. Every `default_agent` created from this release
on has it.

No compat code; nothing to remove. `continual-learning` is not preinstalled anywhere and is
installed the same way.

## Skills installed from the old library: numeric versions, and icons

An installed `SKILL.md` from before this release carries the old natural-number `version` (and
an `updated` date). The parser reads a version that is not `YYYY-MM-DD.N` as the empty string,
and `comparePluginVersions` orders a non-version before every version, so the plugin library
reports each such plugin as updatable once; updating (a whole-plugin reinstall) writes the dated
version. That ordering is the comparison's definition, not a tolerance with an expiry — nothing
is removed later.

Icons: a library install now writes the plugin's `icon.svg` beside every skill it ships and
beside the hook package's `hooks.json`. A skill installed before this release keeps whatever it
had — its own `icon.svg` for the eight library skills that shipped one, the book glyph for the
rest — until the plugin is updated from the library. No action required; no compat code.

## Old Traces: `goal_finished` records and `[goal]` rounds

Traces written by earlier releases carry `goal_finished` event records (readers treat them as
an unknown event and skip them) and round messages that start with a `[goal]` block. The marker
is gone with its parser, so those messages render as plain user text — the block visible, no
round notice — and enter the outline and the input history like any user message; new rounds
carry the `sender: "harness"` stamp instead. Accepted with the marker's removal: the
alternative was keeping a parser for a protocol nothing writes. Nothing to remove later.

## `@prismshadow/penguin-skills`

Deprecated; nothing new is published under that name, and the release chain publishes the
`@penguinharness/*` plugin packages, loaded by `@prismshadow/penguin-core`. The old package
stays on npm as it is. An install that pinned it keeps working with the release it pinned.

## `skills` → `plugins` in Agent creation, `--skills` → `--plugins` in the CLI

The Agent creation body takes `plugins: string[]` (library plugin names) where it took `skills`,
and `penguin agent create` takes `--plugins`. A clean rename, no alias: a script still sending
`skills` gets an Agent with nothing preinstalled (the field is ignored), a script still passing
`--skills` gets the CLI's unknown-option error. Update the call.

## Compatibility

Upgrading asks one thing of one kind of user: whoever hot-pushes this platform onto a running
runtime must restart it first — the push is refused before it touches the database and says
so. Everyone else restarts anyway, and the migration runs at open. Goal mode on an Agent that
existed before this release needs the `goal` plugin installed once from the library. Scripts
that create Agents with `skills` / `--skills` change to `plugins` / `--plugins`.

Downgrading to 0.2.9 works on a migrated database (the table comes back empty at its open);
finished goals' banners do not restore, nothing else is affected. None of the above is a shim
with an expiry: there is nothing to remove in a later release.
