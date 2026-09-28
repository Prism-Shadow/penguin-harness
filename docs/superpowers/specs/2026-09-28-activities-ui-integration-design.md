# Activities UI integration — design

Date: 2026-09-28. Branch: `feat/activity-studio-shell`. Status: approved in brainstorming, awaiting spec review.

## Goal

Make Activities feel like a native part of Penguin Harness rather than Loom embedded in it — both
visually (house tokens, components, tone) and in flow (no lost context moving between the studio,
chat, runs and settings). The studio serves engineers, curriculum and UX authors on one surface
(see the Loom full-port decisions); nothing here introduces role-based views.

## Problems this solves

1. Three columns of navigation when an activity is open: app sidebar, section rail, right icon rail.
2. Lost context: "Open in chat" replaces the page and chat has no way back; activity runs appear as
   unlabelled `run_…` sessions in the global sidebar.
3. Dead ends: the deploy panel tells the user an admin must fill in settings, with no link.
4. Drift from the house style: page header size and width, no `EmptyState`/`Skeleton`, a copied
   segmented control, hand-drawn SVG icons, `window.confirm`, an undocumented `z-30`, local table
   classes.
5. The home page is a flat card grid per ref: no status, and a product's refs are scattered.

## Decisions

- An open activity is a **workspace**: it takes over the page, the app sidebar steps back.
- Studio layout is **grouped section rail + labelled tab dock** (option B of three shown).
- Home page is **cards grouped by product code**, every ref shown (no "+ N more").
- Mockups: `.superpowers/brainstorm/3504-1790586830/content/studio-shell-v2.html` and
  `activity-list-v4.html` (local, git-ignored).

## Section 1 — Studio shell

Applies at `/activities/:activityId`.

**App sidebar.** Collapses automatically to its 48px icon rail, Activities highlighted. The user's
own sidebar state is saved on entry and restored on leaving the route. If the user expands it
inside an activity, it stays expanded until they leave. Implemented in `app-layout.tsx` as a
route-driven override, not by writing the user's stored preference.

**Section rail.** Same resizable/collapsible rail, now grouped under small uppercase, non-collapsible
labels:

| Group | Sections |
| --- | --- |
| Write | Description, Specification, Features |
| Media | Scenes, Speech, Library |
| Build & ship | Module, Configuration, Assessment, Deploy |
| More | Stats, History |

`newRef` stays reachable from the ref switcher, not the rail. Disabled sections remain visible
(existing rule). A section whose stage is running shows a `busy` dot. Grouping lives in
`workspace-model.ts` as data (`workspaceSectionGroups(state)`), so the order and gating logic stays
pure and tested; the existing `workspaceSections` order is changed to match the groups.

**Dock.** The 44px icon rail is replaced by a labelled tab strip — Run · Player · Chat · Runs — over
one closable panel (default 400px, as today). Icons via `GlyphIcon`. The Runs tab shows a count
of live runs. The narrow-screen rule is kept: when the panel cannot sit beside the editor, it
overlays it. The overlay uses a documented layer from the frontend skill, not `z-30`.
`StudioPanel` keys are unchanged (`run | player | conversation | sessions`); only labels and chrome
change, so the existing layout presets keep working. If the open panel is not yet addressable by
URL, add a `?panel=` parameter (needed by the chat back-link in Section 4).

**Chat in the studio.** "Open in chat" becomes selecting the Chat tab with that session. The panel
renders the full `MessageStream` plus a composer, and an "Open full page" link to `/chat/:id` for
those who want it.

**Header.** A breadcrumb replaces the underlined back link: `Activities / <product code> /
<ref switcher>`. Right side: one status chip for the running stage (tone `busy`), Layout menu,
Run all. Stale notices stay as the existing tone strip under the header.

**Layout presets** (Writing, Reviewing, Media) now set rail width/collapse and the dock tab.

## Section 2 — Activities home

Applies at `/activities`.

**Layout.**
- Page header matches the other pages: `p-4 md:p-6`, `max-w-5xl`, `text-xl` title. Actions
  unchanged: Project media, Import from Loom, New activity.
- Filters: search, tag `Segmented`, and a Recent / A–Z sort `Segmented`.
- One group per product code. Heading: code (monospace), type badge, ref count, and an attention
  summary (for example "1 needs attention"). Clicking the heading collapses it; a collapsed group
  keeps a one-line summary.
- Refs as cards: title, ★ for the canonical ref, `ref N · edited <relative time>`, a stage-progress
  bar in neutral gray, and exactly one status: running `<stage>` (`busy`), `<n>` stale
  (`attention`), Built (`success`), or `<stage>` next (`muted`).
- Every ref is shown. A "+ New ref" card ends each group and opens the existing new-ref flow for
  that product's canonical ref. When that flow is unavailable (the canonical ref has no media plan
  yet, the same gate as the `newRef` section), the card is disabled with the reason disclosed.
- Groups sort by their most recently edited ref, or A–Z by product code.
- The Recent strip is removed (the sort makes it redundant) together with `recent-activities.ts`.
- Loading → `Skeleton`; no activities / no matches → `EmptyState`.

**Data.** The list endpoint returns identity fields only (`ActivityRecord`: title, product code,
ref, type, tags, `updatedAt`). Add to each list row:

```ts
interface ActivitySummary {
  canonical: boolean;
  stagesDone: number;
  stagesTotal: number;
  status:
    | { kind: "running"; stage: string }
    | { kind: "stale"; count: number }
    | { kind: "built" }
    | { kind: "next"; stage: string };
}
```

Computed server-side from what `ActivityPipelines` and the staleness rule already know; no
migration. Precedence when several apply: running > stale > built > next. The type lives in a
small type-only module the web package can import without pulling in services (the rule learned
from `sandbox-paths.ts`). The list refreshes on run start/finish via the same event that drives
completion notifications — no polling.

**Web.** A pure `groupByProduct(items, { sort, search, tag })` returns ordered groups. Collapsed
groups persist per project in `localStorage`, like layout presets. All copy in `strings-en`.

## Section 3 — Style fixes

| Today | Change to |
| --- | --- |
| `window.confirm` for discarding changes (3 places in `activities-page.tsx`) | `ConfirmModal` |
| `segment-styles.ts` copying `Segmented` (5 files) | `Segmented`; delete the file |
| Hand-drawn SVG in the right rail and `state-map-view.tsx` | `GlyphIcon`, adding glyphs to `icons.tsx` as needed |
| Side-panel overlay `z-30` | The documented layer |
| `HEAD`/`TH`/`TD` in `deploy-panel.tsx` | The table pattern of `admin-users-page.tsx` |
| `<p>` loading/empty states in the studio | `Skeleton` / `EmptyState` |
| Underlined back link | Section 1 breadcrumb |

Kept deliberately: `max-w-4xl` on inner reading sections (comfortable line length inside a pane).

## Section 4 — Links to the rest of the app

- **Runs leave the global session list.** Sessions that belong to an activity run are hidden from
  the sidebar session list and live in the dock's Runs tab. The server exposes the owning activity
  for a session (from the `activity_runs` records, which carry the run's session); the sidebar
  filters on it. The plan must confirm where the session id is stored in `record_json` before
  choosing between a lookup endpoint and a field on the session list response.
- **Back-link.** `/chat/:sessionId` for an activity-run session shows a banner: "Part of
  *<activity title>* — Back to activity", linking to `/activities/:id?panel=conversation`.
- **Notifications.** Run completion goes through `lib/completion-notify.ts` as well as the toast;
  the notification opens the activity.
- **Quick switcher.** Activities (the page) and individual activities appear as switcher entries.
- **Project media** becomes the route `/activities/media` instead of `?view=media`; the old query
  string redirects.
- **Settings deep link.** A small `openSettings(section)` API (the dialog is local state in
  `user-menu.tsx` today) lets the deploy notice open Settings on the Deploy section.

## Delivery

Four slices on the current branch, each shippable:

1. Style fixes (Section 3).
2. Home: server summary, then the grouped list (Section 2).
3. Studio shell (Section 1).
4. Links to the rest of the app (Section 4).

## Testing

- Unit: `groupByProduct` (grouping, both sorts, search/tag within groups, empty groups dropped);
  the summary calculation and its precedence; `workspaceSectionGroups` gating and order.
- Component: update existing workspace and list tests for the new structure; the chat back-link
  banner shows only for activity-run sessions.
- Each slice checked in the running app at desktop and mobile widths.
- Raw `tsc` after each slice; `gen-ifaces` for the server slice.

## Out of scope

Deploy Manager changes beyond the settings link; any change to what the sections contain; role-based
views; the learner-runtime shell for the sandbox.
