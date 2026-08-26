# Update notification badges lead from the outermost menu to the update itself

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `web`
- **PR:** [#472](https://github.com/Prism-Shadow/penguin-harness/pull/472)

[中文版](2026-08-26-update-badges.zh.md)

A phone-style red dot now marks the chrome whenever something is updatable, and every dot leads
down an unbroken path to the control that performs the update. Two trails carry one: a
**software** update — a newer release for a browser install, or a downloaded client build for
the desktop shell's own window — and an **Agent kernel** update for any Agent in the current
Project. The mobile menu button carries a dot for either.

## The trails

- **Software** — the `<md` top bar's menu button, the collapsed rail's avatar and the pinned
  sidebar's avatar, ending at the user menu's update row and its update dialog.
- **Agent kernel** — the same menu button, the pinned sidebar's Agents entry, the collapsed
  rail's Agents icon, the Agents list card of each outdated Agent, then that Agent's settings
  page: the Overview tab, the Kernel section, and the enabled "update kernel" button beside it.
  The badge clears with the config refresh the update already performs.

The session list's conversation groups are deliberately left unbadged: that list is about
conversations, not Agent configuration, and a dot there would lead to no action.

## Details

- `components/ui/update-dot.tsx` is the one place the badge colour is written, and every dot in
  the feature renders through it — including the sidebar avatar's, which previously drew its own
  accent-coloured mark. A notification badge is not a status tone, so the colour lives there
  rather than in `lib/tone.ts`, whose five tones each judge a thing's state; the component's
  header states that and records the measured contrast on all four surfaces a dot lands on. Each
  dot is `aria-hidden` and its anchor names what is updatable in its `title` and accessible name.
- The update check runs once per browser session from the app layout, so a badge is present on a
  fresh load; it was previously activated by opening the sidebar's user menu. The module-level
  cache keeps it to one request, the check stays fail-soft, and `PENGUIN_UPDATE_CHECK=off`
  produces no dot and no notice.
- A badge only appears where the running mode offers a control to act on. Desktop mode hides the
  server-release row and updates through the shell instead, so the avatar there marks a
  downloaded client build waiting to install rather than a server release; a client download
  still in flight is not badged, since there is nothing to act on until it lands.
- The gates are pure functions in `lib/update-badges.ts` with unit tests: the release gate
  (including the disabled and failed-lookup paths, and an available-but-unnamed release), the
  client-build gate over every shell state, "any Agent outdated", and the combined wording.
- `Tabs` gained an optional per-tab badge, which folds its sentence into the tab's tooltip and
  accessible name and sits inside the button's padding so the tab strip's vertical clip cannot
  cut it.
- One new bilingual string, for the anchor that covers both trails at once and must not claim to
  be either.
