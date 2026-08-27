# Red dots for Skill updates, preset-model updates and unexpected errors — and a way to clear them

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#510](https://github.com/Prism-Shadow/penguin-harness/pull/510)

[中文版](2026-08-27-todo-badges.zh.md)

The phone-style red dot that already marked a software or Agent-kernel update now also marks
three things the user is expected to act on but might reasonably choose not to: **Skill library**
updates, **model library** preset updates, and **unexpected errors** in the cost center. Each dot
leads down an unbroken path to the control that deals with it, and each one can be put down.

## The three trails

- **Skill library** — the sidebar's Skills entry and the collapsed rail's Skills icon, ending at
  the cards whose "update installs" button reinstalls the library copy on every Agent that is
  behind. The gate is a new `skillUpdates` field on the Agent list, so it costs no request of its
  own; running the update reloads that list, and the dot goes down with it.
- **Model library** — the Models entry, ending beside the "sync presets" button. Owner-only, like
  that button: a member has no control at the end of that trail, so the badge never appears for
  one and the probe behind it is not even requested.
- **Cost center** — the Cost Center entry, ending at the errors panel. It counts `unexpected`
  errors only (a business 4xx is the server saying no on purpose) over the **trailing 7 days the
  page opens on**, so the table always holds the rows the dot is talking about.

The mobile menu button keeps carrying one dot for everything; with an unexpected error in the mix
its wording widens from "updates are available" to "something needs attention", because an error
is not an update by any reading.

## Clearing a dot

Acting clears it: updating the Skills, syncing the presets. For the case where the user looks and
decides not to act — a model table deliberately kept off the catalog, an error read and understood
— each page carries a quiet line under its title naming what is waiting, with **Mark as done**
(**Mark as read** in the cost center) beside it.

What a dismissal stores is not "hidden" but the **signature** of what was waved away: the Skill
names with the library versions on offer, the model references that would change, the newest
error's timestamp. The dot stays down only while what is waiting is still exactly that, so a later
Skill version, a catalog release touching a different model, or a newer error raises it again.
Dismissing answers "not this one", never "never tell me again".

Markers are per Project in `localStorage`, following the precedent `session-seen.ts` set for a
read marker the API does not model: per browser rather than per account, and no cross-tab sync.
The cost of a lost marker is one dot to clear again.

## Details

- `lib/todo-badges.ts` holds the three gates and the dismissal rule as pure functions, unit
  tested: distinct-Skill counting across Agents, order independence, the highest library version
  winning when two Agents are behind by different amounts, an Agent list from a server too old to
  send the field, a preset delta separating two same-sized changes, an error window whose oldest
  rows were evicted, and a dismissal that survives the same thing but not a newer one.
- `features/models/catalog-sync.ts` gained `catalogDelta`, which asks the sync action's own
  question of a **saved** model table rather than the page's row state. The badge and the button
  therefore cannot disagree about whether there is anything to do, and a test replays every table
  shape through both to keep it that way — a dot leading to a button that answers "already up to
  date" is the failure this avoids.
- `AgentSummary.skillUpdates` lists the installed Skills the bundled library has moved past, each
  with the version on offer. It is computed in the pass that already counted them: the existence
  check on `SKILL.md` became a read of the same few kilobytes. Skills the library does not carry —
  installed from a zip or a picked directory — are never listed, since there is no library version
  for them to be behind.
- `GET /usage/errors` takes an optional `kind` (`unexpected` / `expected`), which is how the badge
  asks for one row instead of pulling the whole dashboard aggregate for two numbers. A `kind`
  outside that set is a 400 rather than a silently empty page, which would read as "no errors".
- The two probes are cached per Project at module level and fetched once per browser session from
  the same single eager owner as the update check, and are fail-soft in the same way: an
  unreachable probe leaves the gate closed and says nothing.
- The Agents list's "Kernel update needed" capsule is paler. Its fill is now measured against the
  plain gray `Badge` sharing the row — 1.09 : 1 against the card in light and 1.11 : 1 in dark,
  where that neighbour shows 1.10 : 1 and 1.18 : 1 — instead of sitting a fifth louder than it.
  The ink is unchanged and still clears 7.67 : 1 in light and 9.13 : 1 in dark.
- Six new bilingual strings: one sentence per trail (carried unchanged from the dot's tooltip down
  to the page notice), the widened combined wording, and the two clearing labels.
