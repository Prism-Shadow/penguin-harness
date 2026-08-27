# Red dots for Skill updates, preset-model updates and unexpected errors — and a way to clear them

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#510](https://github.com/Prism-Shadow/penguin-harness/pull/510)

[中文版](2026-08-27-todo-badges.zh.md)

The phone-style red dot that marked a software or Agent-kernel update gained three more trails,
for things the user is expected to act on but might reasonably choose not to: **Skill library**
updates, **model library** preset updates, and **unexpected errors** in the cost center. Each dot
leads down an unbroken path to the control that deals with it, and each one can be put down.

## The three trails

- **Skill library** — the sidebar's Skills entry and the collapsed rail's Skills icon, ending at
  the cards whose "update installs" button reinstalls the library copy on every Agent that is
  behind. The gate reads a new `skillUpdates` field on the Agent list, so it added no request of
  its own; running the update reloads that list, and the dot goes down with it.
- **Model library** — the Models entry, ending at the "sync presets" button, which carries the
  dot on the control that acts. Gated on ownership like that button: a member never sees the
  badge, and the probe behind it was not requested at all.
- **Cost center** — the Cost Center entry, ending at the errors panel. The probe counted
  `unexpected` errors only (a business 4xx is the server saying no on purpose), over a trailing
  7-day window.

The mobile menu button kept carrying one dot for everything; with an unexpected error in the mix
its wording widened from "updates are available" to "something needs attention", because an error
is not an update by any reading.

## Clearing a dot

Acting cleared a dot: updating the Skills, syncing the presets. For the case where the user looks
and decides not to act, all three pages got the **same notice in the same place** — directly under
the page title, an `attention`-toned block carrying the red dot the user followed, the trail's own
sentence, and **Mark as handled** (**Mark as read** in the cost center).

A dismissal stored the **signature** of what was waved away: the Skill names with the library
versions on offer, the model references that would change, the newest error's timestamp. The dot
came back only once what was waiting had grown beyond that — a later Skill version, a catalog
release touching a different model, a newer error. Dismissing a batch and then acting on one of
its items left the rest dismissed, and rows leaving the error window — the row cap evicting the
oldest, an Agent deletion taking its rows out from anywhere — never raised the dot again.

The markers were stored per user in `ui_prefs` under `todoDismissed`, keyed by Project, beside
`initialPasswordBannerDismissed`. They therefore follow the account rather than the browser: on a
shared workstation one person's dismissal no longer puts the dots down for the next, and a second
device or a second tab picks up what the first one cleared.

## Details

- `lib/todo-badges.ts` added the three gates and the dismissal rule as pure functions, unit
  tested: distinct-Skill counting across Agents, order independence, the highest library version
  winning when two Agents are behind by different amounts, an Agent list from a server too old to
  send the field, a preset delta separating two same-sized changes, an error window whose oldest
  rows were evicted, and the rest of a dismissed batch staying down after one of it was updated.
- `features/models/catalog-sync.ts` gained `catalogDelta`, which asks the sync action's own
  question of a **saved** model table rather than the page's row state. The badge and the button
  therefore cannot disagree about whether there is anything to do, and a test replays every table
  shape through both to keep it that way — a dot leading to a button that answers "already up to
  date" is the failure this avoids.
- `AgentSummary.skillUpdates` was added: the installed Skills the bundled library has moved past,
  each with the version on offer, computed in the pass that already counted them. Reading them was
  bounded to the first 4 KB of each `SKILL.md`, which is where the frontmatter block sits — the
  preinstalled library runs to roughly 180 KB of `SKILL.md` per Agent, and the Agent list is
  reloaded after every Skill update. Skills the library does not carry — installed from a zip or a
  picked directory — were never listed, since there is no library version for them to be behind.
- `GET /usage/errors` took an optional `kind` (`unexpected` / `expected`), which is how the badge
  asks for one row instead of pulling the whole dashboard aggregate for two numbers. A `kind`
  outside that set answered 400 rather than a silently empty page, which would read as "no errors".
- The two probes were cached per Project at module level and fetched once per browser session from
  the same single eager owner as the update check, fail-soft in the same way: an unreachable probe
  leaves the gate closed and says nothing. Refreshing after a sync or a Skill update bumps a
  per-Project generation, so a probe still in flight from before the action cannot land on top of
  the answer from after it.
- The Agents list's "Kernel update needed" capsule got paler. Its fill was measured against the
  plain gray `Badge` sharing the row — 1.09 : 1 against the card in light and 1.11 : 1 in dark,
  where that neighbour shows 1.10 : 1 and 1.18 : 1 — instead of sitting a fifth louder than it.
  The ink was left unchanged and still clears 7.67 : 1 in light and 9.13 : 1 in dark.
- Six new bilingual strings: one sentence per trail (carried unchanged from the dot's tooltip down
  to the page notice), the widened combined wording, and the two clearing labels.
