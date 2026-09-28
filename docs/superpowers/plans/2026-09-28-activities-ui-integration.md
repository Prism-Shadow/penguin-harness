# Activities UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Activities feel native to Penguin Harness — house components and tones, a grouped home page with status, a studio that owns the page, and links that never strand the user between the studio, chat, runs and settings.

**Architecture:** Four slices on `feat/activity-studio-shell`, each shippable: (1) style fixes, (2) home page with a server-computed per-activity summary, (3) studio shell, (4) cross-links. Every new decision is a pure function in its own module with a vitest unit test; React components stay thin over those functions. The server adds one kernel component (`ActivitySummaryService`) and one session-list field (`activityId`).

**Tech Stack:** React 19, react-router 8, Tailwind 4, zustand (vanilla stores), Vitest 3 (node env, pure logic only), Playwright e2e (`packages/web/e2e/*.spec.mjs`), Hono server with the Penguin kernel (`@Component`, `@Use`, `Interface`, `gen-ifaces`).

**Spec:** `docs/superpowers/specs/2026-09-28-activities-ui-integration-design.md`

## Global Constraints

- Every user-visible string lives in `packages/web/src/lib/strings-en.ts` and is typed in `packages/web/src/lib/strings-types.ts`. No English inside models or components.
- Status colour only through `packages/web/src/lib/tone.ts` (`busy`, `attention`, `success`, `danger`, `muted`). Brand blue is accent/selection only.
- Controls use `size="sm"`.
- Icons render through `GlyphIcon` (`components/ui/glyph-icon.tsx`) with path constants from `components/ui/icons.tsx`.
- Stacking: chrome creates no stacking context; menus `z-40`; modal and drawer overlays `z-50`; portaled panels `z-[60]`. Nothing else.
- Any new `penguin.*` localStorage key is registered in `packages/web/src/lib/install-scope.ts`; storage access is injectable (`Pick<Storage, "getItem" | "setItem">`) and wrapped in try/catch, like `layout-presets.ts`.
- Server: stateful logic is a kernel `@Component` behind an `Interface` class, registered in `packages/server/src/platform.ts`; types the web imports go in small type-only modules re-exported from `packages/server/src/api/types.ts` (never re-export from a service module — see the `sandbox-paths.ts` note).
- Web unit tests: `packages/web/test/<name>.test.ts`, pure logic only (vitest `environment: "node"`); no `.tsx` tests.
- Commands: web tests `pnpm --filter @prismshadow/penguin-web test`; web typecheck `pnpm --filter @prismshadow/penguin-web typecheck`; server tests `pnpm --filter @prismshadow/penguin-server test` (runs gen-ifaces first); server typecheck `pnpm --filter @prismshadow/penguin-server typecheck`; e2e `pnpm --filter @prismshadow/penguin-web test:e2e`.
- Known pre-existing server failures, not caused by this work: `skills.test.ts`, flaky `model-oauth.test.ts`, `project-command-policy` PUT 400. Check the parent commit before believing either.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deviations from the spec (found while planning, decided here)

1. **`Segmented` cannot replace the chip rows.** It is a fixed-column grid without `aria-pressed` and without counts; the activity chip rows wrap and carry counts. The copied class strings are promoted into one shared component, `ChipGroup`, instead (Task 1).
2. **"Stale" means one real, already-computed condition:** the media plan was made from an older specification (`plan.specRevision !== contentRevision(spec)`), the check that already guards speech/images/module. The server has no per-stage stale count anywhere, so the card says "Media plan out of date", not "2 stale".
3. **Progress is three milestones**, the same facts the studio gates its sections on: valid specification, current media plan, module. Not the nine pipeline stages — nothing in the running server computes those.
4. **Dock tabs live in the studio header**, right-aligned, instead of a separate column. Labels: Stages · Player · Chat · Sessions (only "Conversation" → "Chat" and "Agent sessions" → "Sessions" change).
5. **Chat in the studio:** the Conversation panel already embeds chat. The one exit was the Sessions panel's "Open" link; Sessions now expands a run's transcript in place (Task 11).
6. **Run all stays at the foot of the rail** (`PipelineControls`), where it already is; the header gains only the running-stage chip.
7. **Live refresh of the home page** rides the sessions store (activity-run sessions go idle → reload), because no server event exists for activity runs (Task 14).

## Review Focus

1. **An activity with no product row (predates the product level)** — the home page must still show it, in its own group keyed by product code, and the server must call it canonical (as `isCanonicalRef` does). Test in Task 4 and Task 6.
2. **An imported Loom activity whose module exists only in the checkout** — must show as built, not "Module next". Test in Task 5 via `hasModule` returning true for a checkout source.
3. **Leaving an activity with unsaved edits via the new breadcrumb or the sidebar** — must ask once through `ConfirmModal`; confirming navigates, cancelling stays with the edits intact. Covered by the e2e step in Task 2.
4. **The user expanded the app sidebar inside an activity, then left** — their stored preference is what they return to; the auto-collapse never writes `penguin.sidebarCollapsed`. Test in Task 9.
5. **A session belonging to another project's activity run** — never gets an `activityId` in this project's list. Test in Task 13.

---

## Slice 1 — Style fixes

### Task 1: `ChipGroup` replaces `segment-styles.ts`

**Files:**
- Create: `packages/web/src/components/ui/chip-group.tsx`
- Modify: `packages/web/src/features/activities/asset-library-view.tsx:54-61`, `media-library-modal.tsx:176-190`, `create-ref-view.tsx:484-501`, `activity-list.tsx:126-141`, `project-media-view.tsx:175-186`, `speech-coverage.tsx:231-238,345-356,369-384`
- Delete: `packages/web/src/features/activities/segment-styles.ts`

**Interfaces:**
- Produces: `ChipGroup<T extends string>({ label, value, onChange, options, disabled? })`, `options: ReadonlyArray<{ value: T; label: ReactNode; ariaLabel?: string }>`. Task 7 uses it for the tag and sort filters.

- [ ] **Step 1: Create the component** (the class strings are moved verbatim from `segment-styles.ts`, so nothing changes visually)

```tsx
// packages/web/src/components/ui/chip-group.tsx
/**
 * A row of pressable chips in the segmented look: a gray track, the chosen chip raised in
 * white. `Segmented`'s sibling for rows that wrap or carry counts, which its fixed columns
 * do not allow. One chip is pressed at a time.
 */
import type { ReactNode } from "react";

const TRACK = "inline-flex flex-wrap gap-0.5 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800";
const CHIP = "rounded px-2 py-1 text-xs transition-colors duration-150 disabled:opacity-50";
const ON = "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100";
const OFF = "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200";

export function ChipGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
  className = "",
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: ReactNode; ariaLabel?: string }>;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`${TRACK} ${className}`}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            aria-label={option.ariaLabel}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`${CHIP} ${on ? ON : OFF}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Migrate each usage.** Each block `<div role="group" aria-label={X} className={SEGMENTS}>{list.map((o) => <button … aria-pressed={o === v} onClick={() => f(o)} className={…}>{text(o)}</button>)}</div>` becomes `<ChipGroup label={X} value={v} onChange={f} options={list.map((o) => ({ value: o, label: text(o) }))} />`. Specific cases:
  - `media-library-modal.tsx`: `onChange={(option) => { setScope(option); setChosen(""); setCopyError(""); }}`, keep the `{!localOnly && …}` wrapper.
  - `create-ref-view.tsx`: `disabled={creating}`, `onChange={(action) => setRows((previous) => setAction(previous, row.key, action))}`, `label={words.actionsFor(row.key)}`.
  - `activity-list.tsx` (tag filter, value may be null): use sentinel `""` for "all": `value={tag ?? ""}`, `onChange={(v) => onTag(v === "" ? null : v)}`, options `[{ value: "", label: \`${words.all} · ${items.length}\` }, ...counts.map((c) => ({ value: c.tag, label: \`${c.tag} · ${c.count}\` }))]`. Compare tags case-insensitively as before by passing `value={counts.find((c) => c.tag.toLowerCase() === tag?.toLowerCase())?.tag ?? ""}`. (Task 7 rewrites this file; do the migration anyway so this commit stands alone.)
  - `speech-coverage.tsx` L231-238 keeps `tabular-nums` by wrapping the label: `label: <span className="tabular-nums">{S.activities.bulkSpeechLanguage(entry.language, entry.ready, entry.total)}</span>`. L345-356 and L369-384 keep their count spans inside `label`.
  - Remove every `import { SEGMENT, SEGMENTS, SEGMENT_OFF, SEGMENT_ON } from "./segment-styles";`, add `import { ChipGroup } from "../../components/ui/chip-group";`.

- [ ] **Step 3: Delete `segment-styles.ts` and prove nothing imports it**

Run: `rg -n "segment-styles" packages/web/src` — Expected: no output.

- [ ] **Step 4: Typecheck and run the e2e specs that press these chips**

Run: `pnpm --filter @prismshadow/penguin-web typecheck` — Expected: exit 0.
Run: `pnpm --filter @prismshadow/penguin-web test:e2e -- activities.spec.mjs` — Expected: same pass count as before the change (record the baseline first with `git stash`).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/ui/chip-group.tsx packages/web/src/features/activities
git commit -m "refactor(activities): one ChipGroup for the studio's chip rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Discarding edits asks through `ConfirmModal`

**Files:**
- Create: `packages/web/src/features/activities/use-discard-confirm.tsx`
- Modify: `packages/web/src/features/activities/activities-page.tsx:183-196` (route guard), `:1243-1254` (Reload), `:2152-2157` (use candidate)
- Modify: `packages/web/src/lib/strings-en.ts`, `strings-types.ts` (add `S.activities.discardTitle`, `S.activities.discardConfirm`)
- Test: `packages/web/e2e/activities.spec.mjs`

**Interfaces:**
- Produces: `useDiscardConfirm(dirty: () => boolean): { ask: (then: () => void, onCancel?: () => void) => void; modal: ReactNode }` — `onCancel` runs when the user cancels (the route blocker resets there).

- [ ] **Step 1: Add strings**

```ts
// strings-en.ts, inside activities: { … } beside `discard`
discardTitle: "Discard unsaved changes?",
discardConfirm: "Discard",
```
```ts
// strings-types.ts, beside `discard: string;`
discardTitle: string;
discardConfirm: string;
```

- [ ] **Step 2: Write the hook**

```tsx
// packages/web/src/features/activities/use-discard-confirm.tsx
/**
 * Asks before an action that would throw away unsaved edits, through the app's own
 * ConfirmModal rather than the browser's dialog. `ask(then)` runs `then` at once when
 * nothing is unsaved.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { S } from "../../lib/strings";

export function useDiscardConfirm(dirty: () => boolean): {
  ask: (then: () => void, onCancel?: () => void) => void;
  modal: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const ask = useCallback(
    (then: () => void, onCancel?: () => void) => {
      if (!dirty()) return then();
      pending.current = then;
      cancel.current = onCancel ?? null;
      setOpen(true);
    },
    [dirty],
  );
  const close = () => {
    setOpen(false);
    cancel.current?.();
    pending.current = cancel.current = null;
  };
  const confirm = () => {
    setOpen(false);
    const then = pending.current;
    pending.current = cancel.current = null;
    then?.();
  };
  const modal = (
    <ConfirmModal
      open={open}
      title={S.activities.discardTitle}
      confirmLabel={S.activities.discardConfirm}
      onClose={close}
      onConfirm={confirm}
    >
      <p className="text-sm">{S.activities.discard}</p>
    </ConfirmModal>
  );
  return { ask, modal };
}
```

- [ ] **Step 3: Replace the three `window.confirm` calls**

Route guard (replaces L190-196; the blocker now blocks whenever edits are unsaved and the modal decides):
```tsx
const discard = useDiscardConfirm(() => dirty.current);
const blocker = useBlocker(
  ({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && dirty.current,
);
useEffect(() => {
  if (blocker.state !== "blocked") return;
  discard.ask(
    () => blocker.proceed(),
    () => blocker.reset(),
  );
}, [blocker, discard.ask]);
```
Keep `canLeave` for `createDisabled` but make it pure: `const canLeave = useCallback(() => !dirty.current, []);`. Render `{discard.modal}` once at the end of the component's returned tree.

Reload button (L1246-1252) — the editor component has its own `dirty` boolean; add `const discard = useDiscardConfirm(() => dirty);` in that component and:
```tsx
onClick={() =>
  discard.ask(() =>
    void action(async () => {
      const value = await apiFetch<ActivityDetail>(endpoint);
      if (alive.current) accept(value);
    }),
  )
}
```
Use candidate (L2152-2157):
```tsx
onUseCandidate={(candidate) =>
  discard.ask(() => {
    setSpec(candidate);
    setSpecOpen(true);
  })
}
```
Render that component's `{discard.modal}` once too.

- [ ] **Step 4: Prove no browser dialog remains**

Run: `rg -n "window\.confirm" packages/web/src` — Expected: no output.

- [ ] **Step 5: e2e — leaving with unsaved edits asks once, cancel keeps edits, confirm leaves.** Add to `packages/web/e2e/activities.spec.mjs`, reusing the file's existing helpers for creating an activity and editing its description (find the test that types into the description editor and copy its setup):

```js
test("leaving with unsaved edits asks through the app's dialog", async ({ page }) => {
  // setup: open an activity and type into the description, as the existing edit test does
  await page.getByRole("link", { name: "All activities" }).click();
  const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/activities\/[^/?]+/);
  await page.getByRole("link", { name: "All activities" }).click();
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard" }).click();
  await expect(page).toHaveURL(/\/activities$/);
});
```
(`ConfirmModal`'s dismiss button is labelled Cancel. Task 12 keeps the back link's name "All activities", so this test survives it.)

Run: `pnpm --filter @prismshadow/penguin-web test:e2e -- activities.spec.mjs -g "unsaved edits"` — Expected: PASS.

- [ ] **Step 6: Typecheck, commit**

```bash
pnpm --filter @prismshadow/penguin-web typecheck
git add packages/web/src packages/web/e2e/activities.spec.mjs
git commit -m "fix(activities): ask before discarding edits with the app's own dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Icons, layer, table and empty/loading states

**Files:**
- Create: `packages/web/src/components/ui/table-classes.ts`
- Modify: `features/activities/activity-workspace.tsx:304-313,350-362`, `features/activities/deploy-panel.tsx:33-36,226-248`, `features/admin/admin-users-page.tsx:56-75`
- Modify (states): `activities-page.tsx:124`, `activity-stats-view.tsx:91,93`, `conversation-panel.tsx:286`, `deploy-panel.tsx:202`, `implementation-features-view.tsx:112`, `module-document-view.tsx:100`, `project-media-view.tsx:274`, `sessions-panel.tsx:61`, `state-map-view.tsx:560,564`, `storyboard-view.tsx:123`

- [ ] **Step 1: Shared table classes**

```ts
// packages/web/src/components/ui/table-classes.ts
/** The house table: a bordered scroller, a gray header row, divided body rows. */
export const TABLE_WRAP = "overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800";
export const TABLE = "w-full text-sm";
export const TABLE_HEAD_ROW =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
export const TH = "whitespace-nowrap px-3 py-2 font-medium";
export const TBODY = "divide-y divide-gray-100 dark:divide-gray-800/60";
export const TD = "px-3 py-2 align-top";
```
In `deploy-panel.tsx` delete the local `HEAD/TH/TD` and import these (`HEAD` → `TABLE_HEAD_ROW`, wrapper and tbody classes → `TABLE_WRAP`, `TBODY`). In `admin-users-page.tsx` replace the identical inline strings with the same constants.

- [ ] **Step 2: GlyphIcon in the studio rail.** Replace the `<svg width="18" …><path d={entry.icon} /></svg>` at `activity-workspace.tsx:350-362` with `<GlyphIcon d={entry.icon} size={18} />` (import from `../../components/ui/glyph-icon`). Task 10 removes this rail; doing it now keeps slice 1 standalone.

- [ ] **Step 3: Layer.** In `activity-workspace.tsx:311` change `"absolute inset-y-0 z-30 shadow-lg"` to `"absolute inset-y-0 z-50 shadow-lg"` (a panel over the editor is a drawer overlay).

- [ ] **Step 4: Page-level empty and loading states.** These are the states that fill a pane; inline hints inside a section (`text-xs` lines such as `spec-diff-view.tsx:97`, `versions-view.tsx:249`, `asset-library-view.tsx:192`, `book-words-panel.tsx:223`, `layout-menu.tsx:337`, `module-builds-view.tsx:220`, `project-media-view.tsx:382`, `import-dialog.tsx:108`, `speech-coverage.tsx:208`) stay as they are.
  - Empty → `<EmptyState title={…} />` (import from `../../components/ui/empty-state`): `activities-page.tsx:124` (`S.activities.noProject`), `activity-stats-view.tsx:93`, `conversation-panel.tsx:286`, `project-media-view.tsx:274`, `sessions-panel.tsx:61`, `state-map-view.tsx:564`, `storyboard-view.tsx:123`. Keep the same string; drop the `<p>`'s classes.
  - Loading → `<SkeletonList rows={3} />` (import from `../../components/ui/skeleton`): `activity-stats-view.tsx:91`, `deploy-panel.tsx:202`, `implementation-features-view.tsx:112`, `module-document-view.tsx:100`, `state-map-view.tsx:560`. Keep an accessible name: wrap as `<div role="status" aria-label={S.common.loading}><SkeletonList rows={3} /></div>` (use the string the `<p>` showed).

- [ ] **Step 5: Verify**

Run: `rg -n "z-30" packages/web/src/features/activities` — Expected: no output.
Run: `pnpm --filter @prismshadow/penguin-web typecheck` — Expected: exit 0.
Run: `pnpm --filter @prismshadow/penguin-web test:e2e -- activities.spec.mjs` — Expected: baseline pass count. Any test that asserted the old empty/loading `<p>` text still finds it (EmptyState renders the title as text; the status wrapper keeps the loading name).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src
git commit -m "fix(activities): house icons, layer, table and empty states in the studio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Slice 2 — Activities home

### Task 4: The summary rule (server, pure)

**Files:**
- Create: `packages/server/src/activities/activity-summary.ts`
- Modify: `packages/server/src/api/types.ts` (re-export the types)
- Test: `packages/server/test/activity-summary.test.ts`

**Interfaces:**
- Produces:
```ts
export type SummaryMilestone = "spec" | "mediaPlan" | "module";
export const SUMMARY_MILESTONES: readonly SummaryMilestone[]; // ["spec","mediaPlan","module"]
export type ActivitySummaryStatus =
  | { kind: "running"; runKind: ActivityRun["kind"] }
  | { kind: "stale"; what: "mediaPlan" }
  | { kind: "built" }
  | { kind: "next"; milestone: SummaryMilestone };
export interface ActivitySummary { canonical: boolean; hasPlan: boolean; done: number; total: number; status: ActivitySummaryStatus; }
export interface SummaryFacts {
  canonical: boolean;
  specValid: boolean;          // draft.status === "valid" && draft.spec !== null
  plan: "none" | "current" | "stale"; // mediaPlan absent / specRevision matches / differs
  hasModule: boolean;
  runningKind: ActivityRun["kind"] | null;
}
export function summarize(facts: SummaryFacts): ActivitySummary;
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/test/activity-summary.test.ts
import { describe, expect, it } from "vitest";
import { summarize, type SummaryFacts } from "../src/activities/activity-summary.js";

const fresh: SummaryFacts = {
  canonical: true,
  specValid: false,
  plan: "none",
  hasModule: false,
  runningKind: null,
};

describe("summarize", () => {
  it("names the first missing milestone as next", () => {
    expect(summarize(fresh)).toEqual({
      canonical: true,
      hasPlan: false,
      done: 0,
      total: 3,
      status: { kind: "next", milestone: "spec" },
    });
    expect(summarize({ ...fresh, specValid: true }).status).toEqual({
      kind: "next",
      milestone: "mediaPlan",
    });
    expect(summarize({ ...fresh, specValid: true, plan: "current" }).status).toEqual({
      kind: "next",
      milestone: "module",
    });
  });

  it("counts a stale plan as not done and reports it", () => {
    const summary = summarize({ ...fresh, specValid: true, plan: "stale", hasModule: true });
    expect(summary.done).toBe(2);
    expect(summary.hasPlan).toBe(true);
    expect(summary.status).toEqual({ kind: "stale", what: "mediaPlan" });
  });

  it("is built when every milestone is reached", () => {
    const summary = summarize({ ...fresh, specValid: true, plan: "current", hasModule: true });
    expect(summary).toMatchObject({ done: 3, status: { kind: "built" } });
  });

  it("puts a running run above everything else", () => {
    const summary = summarize({
      ...fresh,
      specValid: true,
      plan: "stale",
      hasModule: true,
      runningKind: "audio",
    });
    expect(summary.status).toEqual({ kind: "running", runKind: "audio" });
  });

  it("counts an imported module without a plan as built only once the plan exists", () => {
    // A Loom import can play from the checkout before Penguin planned its media.
    const summary = summarize({ ...fresh, specValid: true, hasModule: true });
    expect(summary).toMatchObject({ done: 2, status: { kind: "next", milestone: "mediaPlan" } });
  });

  it("passes canonical through", () => {
    expect(summarize({ ...fresh, canonical: false }).canonical).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — fails**

Run: `pnpm --filter @prismshadow/penguin-server exec vitest run test/activity-summary.test.ts`
Expected: FAIL — cannot find module `activity-summary.js`.

- [ ] **Step 3: Implement**

```ts
// packages/server/src/activities/activity-summary.ts
/**
 * What the Activities home says about one ref: how far along it is and the one thing
 * worth knowing now. Three milestones — the facts the studio already gates its sections
 * on — rather than the nine pipeline stages, which nothing running computes per activity.
 * Type-only imports, so the web can read these types without pulling in services.
 */
import type { ActivityRun } from "./domain.js";

export type SummaryMilestone = "spec" | "mediaPlan" | "module";
export const SUMMARY_MILESTONES: readonly SummaryMilestone[] = ["spec", "mediaPlan", "module"];

export type ActivitySummaryStatus =
  | { kind: "running"; runKind: ActivityRun["kind"] }
  | { kind: "stale"; what: "mediaPlan" }
  | { kind: "built" }
  | { kind: "next"; milestone: SummaryMilestone };

export interface ActivitySummary {
  canonical: boolean;
  /** Any media plan, current or not: what a new ref copies, so the New ref card waits for it. */
  hasPlan: boolean;
  done: number;
  total: number;
  status: ActivitySummaryStatus;
}

export interface SummaryFacts {
  canonical: boolean;
  specValid: boolean;
  plan: "none" | "current" | "stale";
  hasModule: boolean;
  runningKind: ActivityRun["kind"] | null;
}

export function summarize(facts: SummaryFacts): ActivitySummary {
  const reached: Record<SummaryMilestone, boolean> = {
    spec: facts.specValid,
    mediaPlan: facts.plan === "current",
    module: facts.hasModule,
  };
  const done = SUMMARY_MILESTONES.filter((milestone) => reached[milestone]).length;
  const missing = SUMMARY_MILESTONES.find((milestone) => !reached[milestone]);
  // Precedence: live work, then something that needs redoing, then finished, then next.
  const status: ActivitySummaryStatus = facts.runningKind
    ? { kind: "running", runKind: facts.runningKind }
    : facts.plan === "stale"
      ? { kind: "stale", what: "mediaPlan" }
      : missing
        ? { kind: "next", milestone: missing }
        : { kind: "built" };
  return {
    canonical: facts.canonical,
    hasPlan: facts.plan !== "none",
    done,
    total: SUMMARY_MILESTONES.length,
    status,
  };
}
```

In `packages/server/src/api/types.ts`, after the `export type { SandboxStatus, SandboxBuildReport } …` line (~4863):
```ts
export type {
  ActivitySummary,
  ActivitySummaryStatus,
  SummaryMilestone,
} from "../activities/activity-summary.js";
```

- [ ] **Step 4: Run — passes**

Run: `pnpm --filter @prismshadow/penguin-server exec vitest run test/activity-summary.test.ts` — Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/activities/activity-summary.ts packages/server/src/api/types.ts packages/server/test/activity-summary.test.ts
git commit -m "feat(activities): the rule for an activity's home-page summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: `ActivitySummaryService` and `?summary=1` on the list route

**Files:**
- Modify: `packages/server/src/activities/sandbox-service.ts` (interface ~L181, class ~L249: add `hasModule`)
- Create: `packages/server/src/activities/summary-service.ts`
- Modify: `packages/server/src/platform.ts:105-106,409-410` (import + register)
- Modify: `packages/server/src/activities/routes.ts:91-94,130-136`
- Test: `packages/server/test/activities-summary-api.test.ts`

**Interfaces:**
- Consumes: `summarize`, `SummaryFacts`, `ActivitySummary` (Task 4); `ActivityAuthoring.getActivity`, `ActivityAuthoring.isCanonicalRef`, `ActivityGeneration.list`, `contentRevision` from `domain.ts`.
- Produces: `ActivitySandbox.hasModule(projectId: string, activity: ActivityRecord): Promise<boolean>`; `ActivitySummaries.forActivities(projectId: string, activities: readonly ActivityRecord[]): Promise<Record<string, ActivitySummary>>`; list response `{ collectionId, activities, summaries?: Record<string, ActivitySummary> }` when `?summary=1`.

- [ ] **Step 1: Write the failing API test** (follows `packages/server/test/activities-api.test.ts`)

```ts
// packages/server/test/activities-summary-api.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

describe("activity list summaries", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("adds a summary per activity only when asked", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "summary_owner");
    const client = apiClient(t.app, owner.cookie);
    await client.post("/api/projects", { projectId: "summary_owner-p", name: "P" });
    const first = await client.post("/api/projects/summary_owner-p/activities", {
      productCode: "ants",
      refNum: 1,
      title: "Counting ants",
    });
    const second = await client.post("/api/projects/summary_owner-p/activities", {
      productCode: "ants",
      refNum: 2,
      title: "Ants at night",
    });
    const firstId = (await first.json()).id as string;
    const secondId = (await second.json()).id as string;

    const plain = await (await client.get("/api/projects/summary_owner-p/activities")).json();
    expect(plain.summaries).toBeUndefined();

    const withSummary = await (
      await client.get("/api/projects/summary_owner-p/activities?summary=1")
    ).json();
    expect(withSummary.summaries[firstId]).toEqual({
      canonical: true,
      hasPlan: false,
      done: 0,
      total: 3,
      status: { kind: "next", milestone: "spec" },
    });
    // The product's first ref is canonical; the second is not.
    expect(withSummary.summaries[secondId].canonical).toBe(false);
  });
});
```
(If `client.get`/`.json()` differ in `helpers.js`, match `activities-api.test.ts` exactly — read its first 60 lines before writing.)

- [ ] **Step 2: Run — fails**

Run: `pnpm --filter @prismshadow/penguin-server exec vitest run test/activities-summary-api.test.ts`
Expected: FAIL — `withSummary.summaries` is undefined.

- [ ] **Step 3: `hasModule` on the sandbox.** Interface (`sandbox-service.ts`, inside `ActivitySandbox extends Interface<{ … }>`):
```ts
  /** Whether a module exists to play: a built run, or the product's checkout folder. */
  hasModule(projectId: string, activity: ActivityRecord): Promise<boolean>;
```
Class (`ActivitySandboxService`, next to `status`):
```ts
  async hasModule(projectId: string, activity: ActivityRecord): Promise<boolean> {
    const source = await this.moduleSource(projectId, activity);
    if (!source) return false;
    const definition = await fs.stat(path.join(source.root, "definition.json")).catch(() => null);
    return Boolean(definition?.isFile());
  }
```
(`ActivityRecord` is already imported there via `moduleSource`'s signature; add it to the type import from `./domain.js` if not.)

- [ ] **Step 4: The service**

```ts
// packages/server/src/activities/summary-service.ts
/**
 * The Activities home's per-ref summary: gathers the facts `summarize` needs for every
 * activity of a list. A few reads per activity (its draft, its runs, whether a module
 * exists); a project holds tens of refs, not thousands.
 */
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { ActivitySandbox } from "./sandbox-service.js";
import { contentRevision, type ActivityRecord } from "./domain.js";
import { summarize, type ActivitySummary } from "./activity-summary.js";

export abstract class ActivitySummaries extends Interface<{
  forActivities(
    projectId: string,
    activities: readonly ActivityRecord[],
  ): Promise<Record<string, ActivitySummary>>;
}>() {}

@Component()
export class ActivitySummaryService implements ActivitySummaries {
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly sandbox!: ActivitySandbox;

  async forActivities(projectId: string, activities: readonly ActivityRecord[]) {
    const entries = await Promise.all(
      activities.map(async (record) => [record.id, await this.one(projectId, record)] as const),
    );
    return Object.fromEntries(entries);
  }

  private async one(projectId: string, record: ActivityRecord): Promise<ActivitySummary> {
    const [activity, runs, hasModule] = await Promise.all([
      this.activities.getActivity(projectId, record.id),
      this.generation.list(projectId, record.id),
      this.sandbox.hasModule(projectId, record),
    ]);
    const { draft } = activity;
    const plan = draft.mediaPlan;
    return summarize({
      canonical: this.activities.isCanonicalRef(record),
      specValid: draft.status === "valid" && draft.spec !== null,
      plan: !plan
        ? "none"
        : plan.specRevision === contentRevision(draft.spec)
          ? "current"
          : "stale",
      hasModule,
      runningKind: runs.find((run) => run.status === "running")?.kind ?? null,
    });
  }
}
```

- [ ] **Step 5: Register and route.** `platform.ts`: add `import { ActivitySummaryService } from "./activities/summary-service.js";` beside L106 and `ActivitySummaryService,` beside L410. `routes.ts`: add `@Use() private readonly summaries!: ActivitySummaries;` (type import from `./summary-service.js`) next to L94, and replace the handler at L130-136:
```ts
      app.get("/", async (c) => {
        const projectId = requireValidId(c, "projectId");
        const activities = await this.activities.listActivities(
          projectId,
          c.req.query("collectionId"),
        );
        const summaries =
          c.req.query("summary") === "1"
            ? await this.summaries.forActivities(projectId, activities)
            : undefined;
        return c.json({
          collectionId: activities[0]?.collectionId ?? null,
          activities,
          ...(summaries ? { summaries } : {}),
        });
      });
```

- [ ] **Step 6: Run — passes; typecheck**

Run: `pnpm --filter @prismshadow/penguin-server test -- activities-summary-api` — Expected: PASS (this runs gen-ifaces first, which registers the new interface).
Run: `pnpm --filter @prismshadow/penguin-server typecheck` — Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src packages/server/test/activities-summary-api.test.ts
git commit -m "feat(activities): per-activity summaries on the list route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Grouping by product code (web, pure)

**Files:**
- Create: `packages/web/src/features/activities/activity-groups.ts`
- Modify: `packages/web/src/lib/install-scope.ts` (register the collapsed-groups key)
- Test: `packages/web/test/activities-groups.test.ts`

**Interfaces:**
- Consumes: `ActivityRecord`, `ActivitySummary` from `@prismshadow/penguin-server/api`.
- Produces:
```ts
export type GroupSort = "recent" | "code";
export interface ActivityGroup {
  productCode: string;
  activityType: "standard" | "book";
  items: ActivityRecord[];            // canonical first, then by refNum
  canonicalId: string | null;         // null when no item is canonical
  attention: number;                  // items whose status is stale
  latest: string;                     // max updatedAt
}
export function groupByProduct(items: readonly ActivityRecord[], summaries: Readonly<Record<string, ActivitySummary>>, options: { sort: GroupSort; search: string; tag: string | null }): ActivityGroup[];
export const COLLAPSED_GROUPS_KEY = "penguin.activities.collapsedGroups";
export function readCollapsed(projectId: string, storage?: Pick<Storage, "getItem">): Set<string>;
export function writeCollapsed(projectId: string, collapsed: ReadonlySet<string>, storage?: Pick<Storage, "getItem" | "setItem">): void;
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/activities-groups.test.ts
import { describe, expect, it } from "vitest";
import type { ActivityRecord, ActivitySummary } from "@prismshadow/penguin-server/api";
import {
  groupByProduct,
  readCollapsed,
  writeCollapsed,
} from "../src/features/activities/activity-groups";

function item(id: string, productCode: string, refNum: number, updatedAt: string, extra: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id,
    productCode,
    refNum,
    collectionId: "c",
    productId: `p-${productCode}`,
    title: `${productCode} ${refNum}`,
    displayName: null,
    stable: false,
    activityType: "standard",
    createdAt: updatedAt,
    updatedAt,
    archived: false,
    tags: [],
    ...extra,
  };
}
const summary = (canonical: boolean, stale = false): ActivitySummary => ({
  canonical,
  hasPlan: stale,
  done: 1,
  total: 3,
  status: stale ? { kind: "stale", what: "mediaPlan" } : { kind: "next", milestone: "mediaPlan" },
});

const items = [
  item("a3", "ants", 3, "2026-09-20T00:00:00Z"),
  item("a5", "ants", 5, "2026-09-27T00:00:00Z"),
  item("b1", "book", 1, "2026-09-25T00:00:00Z", { activityType: "book", tags: ["Reading"] }),
];
const summaries = { a3: summary(true), a5: summary(false, true), b1: summary(true) };
const all = { sort: "recent" as const, search: "", tag: null };

describe("groupByProduct", () => {
  it("groups by product code, newest group first, canonical ref first inside", () => {
    const groups = groupByProduct(items, summaries, all);
    expect(groups.map((group) => group.productCode)).toEqual(["ants", "book"]);
    expect(groups[0].items.map((entry) => entry.id)).toEqual(["a3", "a5"]);
    expect(groups[0]).toMatchObject({ canonicalId: "a3", attention: 1, latest: "2026-09-27T00:00:00Z" });
    expect(groups[1].activityType).toBe("book");
  });

  it("sorts A-Z by product code", () => {
    const groups = groupByProduct(items, summaries, { ...all, sort: "code" });
    expect(groups.map((group) => group.productCode)).toEqual(["ants", "book"]);
    const reversed = groupByProduct(
      [item("z1", "zebra", 1, "2026-09-28T00:00:00Z"), ...items],
      summaries,
      { ...all, sort: "code" },
    );
    expect(reversed.map((group) => group.productCode)).toEqual(["ants", "book", "zebra"]);
  });

  it("filters inside groups and drops groups left empty", () => {
    const groups = groupByProduct(items, summaries, { ...all, search: "5" });
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((entry) => entry.id)).toEqual(["a5"]);
    expect(groupByProduct(items, summaries, { ...all, tag: "reading" }).map((g) => g.productCode)).toEqual(["book"]);
  });

  it("keeps an activity without a product or summary", () => {
    const orphan = item("o1", "legacy", 1, "2026-09-01T00:00:00Z", { productId: null });
    const groups = groupByProduct([orphan], {}, all);
    expect(groups).toEqual([
      expect.objectContaining({ productCode: "legacy", canonicalId: null, attention: 0 }),
    ]);
  });
});

describe("collapsed groups", () => {
  function memory() {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  }
  it("remembers collapsed groups per project", () => {
    const storage = memory();
    writeCollapsed("p1", new Set(["ants"]), storage);
    expect([...readCollapsed("p1", storage)]).toEqual(["ants"]);
    expect(readCollapsed("p2", storage).size).toBe(0);
  });
  it("reads garbage as nothing collapsed", () => {
    const storage = memory();
    storage.setItem("penguin.activities.collapsedGroups", "{not json");
    expect(readCollapsed("p1", storage).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `pnpm --filter @prismshadow/penguin-web exec vitest run test/activities-groups.test.ts`
Expected: FAIL — cannot resolve `activity-groups`.

- [ ] **Step 3: Implement.** Search/tag filtering reuses the list's existing rules, `filterByTag` (`./activity-tags`) and `filterActivities` (`./preview`), rather than re-implementing them.

```ts
// packages/web/src/features/activities/activity-groups.ts
/**
 * The Activities home's groups: one per product code, its refs as cards. A product's refs
 * belong together (one product has ten), and a product code is what authors search by.
 */
import type { ActivityRecord, ActivitySummary } from "@prismshadow/penguin-server/api";
import { filterByTag } from "./activity-tags";
import { filterActivities } from "./preview";

export type GroupSort = "recent" | "code";

export interface ActivityGroup {
  productCode: string;
  activityType: "standard" | "book";
  items: ActivityRecord[];
  canonicalId: string | null;
  attention: number;
  latest: string;
}

export function groupByProduct(
  items: readonly ActivityRecord[],
  summaries: Readonly<Record<string, ActivitySummary>>,
  options: { sort: GroupSort; search: string; tag: string | null },
): ActivityGroup[] {
  const visible = filterActivities(filterByTag(items, options.tag), options.search);
  const byCode = new Map<string, ActivityRecord[]>();
  for (const entry of visible) {
    const list = byCode.get(entry.productCode) ?? [];
    list.push(entry);
    byCode.set(entry.productCode, list);
  }
  const groups = [...byCode.entries()].map(([productCode, refs]): ActivityGroup => {
    const canonical = refs.find((entry) => summaries[entry.id]?.canonical) ?? null;
    const ordered = [...refs].sort((left, right) =>
      left === canonical ? -1 : right === canonical ? 1 : left.refNum - right.refNum,
    );
    return {
      productCode,
      activityType: refs[0].activityType,
      items: ordered,
      canonicalId: canonical?.id ?? null,
      attention: refs.filter((entry) => summaries[entry.id]?.status.kind === "stale").length,
      latest: refs.reduce((max, entry) => (entry.updatedAt > max ? entry.updatedAt : max), ""),
    };
  });
  return groups.sort((left, right) =>
    options.sort === "code"
      ? left.productCode.localeCompare(right.productCode)
      : right.latest.localeCompare(left.latest) || left.productCode.localeCompare(right.productCode),
  );
}

export const COLLAPSED_GROUPS_KEY = "penguin.activities.collapsedGroups";

type CollapsedStore = Record<string, string[]>;

function readStore(storage: Pick<Storage, "getItem">): CollapsedStore {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(COLLAPSED_GROUPS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as CollapsedStore)
      : {};
  } catch {
    return {};
  }
}

export function readCollapsed(
  projectId: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): Set<string> {
  const codes = readStore(storage)[projectId];
  return new Set(Array.isArray(codes) ? codes.filter((code) => typeof code === "string") : []);
}

export function writeCollapsed(
  projectId: string,
  collapsed: ReadonlySet<string>,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  try {
    const store = readStore(storage);
    store[projectId] = [...collapsed];
    storage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(store));
  } catch {
    // Remembering folds is a convenience; a blocked storage just forgets them.
  }
}
```
In `install-scope.ts`, beside the `penguin.activities.recent` entry (L256-261), add:
```ts
  {
    kind: "exact",
    key: "penguin.activities.collapsedGroups",
    scope: "install",
    why: "Product groups each Project folded on the Activities home, keyed by Project id; a new root has none.",
  },
```

- [ ] **Step 4: Run — passes**

Run: `pnpm --filter @prismshadow/penguin-web exec vitest run test/activities-groups.test.ts` — Expected: 6 passed.
Run: `pnpm --filter @prismshadow/penguin-web test` — Expected: no new failures (install-scope has its own test that checks registrations).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/activities/activity-groups.ts packages/web/src/lib/install-scope.ts packages/web/test/activities-groups.test.ts
git commit -m "feat(activities): group the home page by product code

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The grouped home page

**Files:**
- Modify: `packages/web/src/features/activities/activity-list.tsx` (rewrite body; props change)
- Modify: `packages/web/src/features/activities/activities-page.tsx:87,166-179,203,234-250,299`
- Delete: `packages/web/src/features/activities/recent-activities.ts`, its test `packages/web/test/activities-recent*.test.ts` (find with `rg -l recent-activities packages/web/test`), and its `install-scope.ts` entry (L256-261)
- Modify: `strings-en.ts` / `strings-types.ts`
- Test: `packages/web/e2e/activities.spec.mjs`

**Interfaces:**
- Consumes: `groupByProduct`, `readCollapsed`, `writeCollapsed`, `GroupSort` (Task 6); `ActivitySummary` (Task 4); `ChipGroup` (Task 1).
- Produces: `ActivityList` props: remove `recent`; add `summaries: Readonly<Record<string, ActivitySummary>>`, `projectId: string`, `sort: GroupSort`, `onSort: (sort: GroupSort) => void`.

- [ ] **Step 1: Strings** (in `activities: { … }`; mirror each in `strings-types.ts`)

```ts
home: {
  sortLabel: "Sort",
  sort: { recent: "Recent", code: "A–Z" },
  refs: (count: number) => (count === 1 ? "1 ref" : `${count} refs`),
  attention: (count: number) => `${count} needs attention`,
  collapse: (code: string) => `Collapse ${code}`,
  expand: (code: string) => `Expand ${code}`,
  refLine: (refNum: number, when: string) => `ref ${refNum} · ${when}`,
  canonical: "Canonical ref",
  progress: (done: number, total: number) => `${done} of ${total} milestones`,
  newRef: "New ref",
  newRefUnavailable: "Plan the canonical ref's media first; a new ref copies its media plan.",
  status: {
    running: (what: string) => `${what} running`,
    stale: "Media plan out of date",
    built: "Built",
    next: { spec: "Specification next", mediaPlan: "Media plan next", module: "Module next" },
  },
},
```
`what` for running is `runTitle(run.kind)` from `sessions-panel.tsx` (already localised). Types:
```ts
home: {
  sortLabel: string;
  sort: { recent: string; code: string };
  refs: (count: number) => string;
  attention: (count: number) => string;
  collapse: (code: string) => string;
  expand: (code: string) => string;
  refLine: (refNum: number, when: string) => string;
  canonical: string;
  progress: (done: number, total: number) => string;
  newRef: string;
  newRefUnavailable: string;
  status: {
    running: (what: string) => string;
    stale: string;
    built: string;
    next: { spec: string; mediaPlan: string; module: string };
  };
};
```
Remove `recent: { title, all }` from both files.

- [ ] **Step 2: Rewrite the list.** Keep the file's existing banners (`unavailable`, `readOnly`, `error`) as they are. Replace the header wrapper, filters, recent section and grid:

```tsx
// activity-list.tsx — structure (imports: Link, useMemo, useState, Button, Input, EmptyState,
// SkeletonList, ChipGroup, Chevron, S, toneDot, toneInk, useLocale, formatRelativeShort,
// groupByProduct/readCollapsed/writeCollapsed/GroupSort, runTitle from ./sessions-panel,
// ActivityRecord/ActivitySummary types)
return (
  <div className="h-full overflow-auto">
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{S.activities.title}</h1>
        {/* the existing four buttons, unchanged */}
      </header>
      {/* existing banners unchanged */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Input size="sm" aria-label={S.activities.search} placeholder={S.activities.search}
            value={search} onChange={(event) => onSearch(event.target.value)} className="max-w-sm" />
          {counts.length > 0 && (
            <ChipGroup label={words.filter} value={tagValue} onChange={(v) => onTag(v === "" ? null : v)}
              options={[{ value: "", label: `${words.all} · ${items.length}` },
                ...counts.map((c) => ({ value: c.tag, label: `${c.tag} · ${c.count}` }))]} />
          )}
          <span className="flex-1" />
          <ChipGroup label={home.sortLabel} value={sort} onChange={onSort}
            options={[{ value: "recent", label: home.sort.recent }, { value: "code", label: home.sort.code }]} />
        </div>
      )}
      {loading ? (
        <div role="status" aria-label={S.activities.loading}><SkeletonList rows={4} /></div>
      ) : groups.length === 0 ? (
        <EmptyState title={items.length === 0 ? S.activities.empty : S.activities.noMatches} />
      ) : (
        groups.map((group) => (
          <ProductGroup key={group.productCode} group={group} summaries={summaries}
            collapsed={collapsed.has(group.productCode)} onToggle={() => toggle(group.productCode)}
            editable={editable && available} />
        ))
      )}
    </div>
  </div>
);
```
with, above the return:
```tsx
const home = S.activities.home;
const groups = useMemo(() => groupByProduct(items, summaries, { sort, search, tag }), [items, summaries, sort, search, tag]);
const [collapsed, setCollapsed] = useState(() => readCollapsed(projectId));
function toggle(code: string) {
  setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(code)) next.delete(code); else next.add(code);
    writeCollapsed(projectId, next);
    return next;
  });
}
const tagValue = counts.find((c) => c.tag.toLowerCase() === tag?.toLowerCase())?.tag ?? "";
```
Group and card components (same file):
```tsx
function ProductGroup({ group, summaries, collapsed, onToggle, editable }: {
  group: ActivityGroup; summaries: Readonly<Record<string, ActivitySummary>>;
  collapsed: boolean; onToggle: () => void; editable: boolean;
}) {
  const home = S.activities.home;
  const canonical = group.canonicalId ? summaries[group.canonicalId] : undefined;
  // A new ref copies the canonical ref's media plan, so it waits for one — the same gate as
  // the studio's New ref section (`hasPlan`).
  const canAddRef = editable && !!canonical?.hasPlan;
  const headingId = `group-${group.productCode}`;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="border-b border-gray-200 pb-2 dark:border-gray-800">
        <button type="button" aria-expanded={!collapsed}
          aria-label={collapsed ? home.expand(group.productCode) : home.collapse(group.productCode)}
          onClick={onToggle} className="flex w-full items-center gap-2 text-left">
          <Chevron open={!collapsed} />
          <span className="font-mono text-sm font-semibold">{group.productCode}</span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-normal dark:bg-gray-800">
            {group.activityType === "book" ? S.activities.book : S.activities.standard}
          </span>
          <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
            {home.refs(group.items.length)}
            {group.attention > 0 && ` · ${home.attention(group.attention)}`}
          </span>
        </button>
      </h2>
      {!collapsed && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {group.items.map((item) => (
            <li key={item.id}><ActivityCard item={item} summary={summaries[item.id]} /></li>
          ))}
          {editable && (
            <li>
              {canAddRef ? (
                <Link to={`/activities/${group.canonicalId}?section=newRef`}
                  className="flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900">
                  + {home.newRef}
                </Link>
              ) : (
                <span aria-disabled title={home.newRefUnavailable}
                  className="flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm text-gray-400 dark:border-gray-800">
                  + {home.newRef}
                </span>
              )}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function ActivityCard({ item, summary }: { item: ActivityRecord; summary?: ActivitySummary }) {
  const home = S.activities.home;
  const { locale } = useLocale();
  return (
    <Link to={`/activities/${item.id}`}
      className="flex h-full min-h-24 flex-col gap-1.5 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-medium">{item.displayName ?? item.title}</span>
        {summary?.canonical && <span className="text-gray-400" aria-label={home.canonical} title={home.canonical}>★</span>}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {home.refLine(item.refNum, formatRelativeShort(item.updatedAt, locale))}
      </span>
      {summary && (
        <span className="mt-auto flex items-center justify-between gap-2">
          <span className="flex max-w-24 flex-1 gap-0.5" role="img" aria-label={home.progress(summary.done, summary.total)}>
            {Array.from({ length: summary.total }, (_, index) => (
              <i key={index} className={`h-1 flex-1 rounded-full ${index < summary.done ? "bg-gray-400 dark:bg-gray-500" : "bg-gray-200 dark:bg-gray-800"}`} />
            ))}
          </span>
          <SummaryStatus status={summary.status} />
        </span>
      )}
    </Link>
  );
}

function SummaryStatus({ status }: { status: ActivitySummary["status"] }) {
  const words = S.activities.home.status;
  const [tone, text] =
    status.kind === "running" ? (["busy", words.running(runTitle(status.runKind))] as const)
    : status.kind === "stale" ? (["attention", words.stale] as const)
    : status.kind === "built" ? (["success", words.built] as const)
    : (["muted", words.next[status.milestone]] as const);
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${toneInk[tone]}`}>
      {tone !== "muted" && <span aria-hidden className={`size-1.5 rounded-full ${toneDot[tone]}`} />}
      {text}
    </span>
  );
}
```
(`Chevron` takes `open`, `size`, `className`.)

- [ ] **Step 3: Page wiring** (`activities-page.tsx`)
  - L166-179: fetch `apiFetch<{ activities: ActivityRecord[]; summaries?: Record<string, ActivitySummary> }>(\`${basePath(projectId)}?summary=1\`)`, keep `setItems(result.activities)`, add `const [summaries, setSummaries] = useState<Record<string, ActivitySummary>>({});` and `setSummaries(result.summaries ?? {})`.
  - Add `const [sort, setSort] = useState<GroupSort>("recent");`.
  - Delete L87 import of `pushRecent, readRecent`, L203 `recent` memo, L299 `pushRecent(...)`.
  - Call site L234-250: drop `recent={recent}`, add `projectId={projectId} summaries={summaries} sort={sort} onSort={setSort}`.
  - Delete `recent-activities.ts`, its test, and its install-scope entry.

- [ ] **Step 4: Typecheck and unit tests**

Run: `pnpm --filter @prismshadow/penguin-web typecheck` — Expected: exit 0.
Run: `pnpm --filter @prismshadow/penguin-web test` — Expected: all pass (the deleted recent test is gone; install-scope test still passes).

- [ ] **Step 5: e2e.** In `activities.spec.mjs`, replace assertions on "Recently opened"/"All activities" section headings (search: `rg -n "Recently opened" packages/web/e2e`) and add:

```js
test("the home page groups refs under their product code", async ({ page }) => {
  // setup: create two refs of one product ("ants" 1 and 2) the way existing tests create activities
  await page.goto("/activities");
  const group = page.getByRole("region", { name: /ants/ });
  await expect(group.getByRole("link", { name: /ants 1/ })).toBeVisible();
  await expect(group.getByText("Specification next").first()).toBeVisible();
  await group.getByRole("button", { name: "Collapse ants" }).click();
  await expect(group.getByRole("link", { name: /ants 1/ })).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand ants" })).toBeVisible();
});
```
Run: `pnpm --filter @prismshadow/penguin-web test:e2e -- activities.spec.mjs` — Expected: PASS.

- [ ] **Step 6: Look at it.** Start the app (`/run` skill or the project's dev command), open `/activities` at desktop width and at 375px; compare against `.superpowers/brainstorm/3504-1790586830/content/activity-list-v4.html`. Expected: groups, one status per card, no horizontal scroll at 375px.

- [ ] **Step 7: Commit**

```bash
git add -A packages/web/src packages/web/test packages/web/e2e
git commit -m "feat(activities): home page grouped by product code with status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Slice 3 — Studio shell

### Task 8: Sections grouped by phase

**Files:**
- Modify: `packages/web/src/features/activities/workspace-model.ts:49-75` (order) + new exports
- Modify: `packages/web/src/features/activities/studio-tree.ts:145-158` (row order) + `phaseOfNode`
- Modify: `packages/web/src/features/activities/studio-tree-view.tsx` (phase labels at top level)
- Modify: `strings-en.ts` / `strings-types.ts` (`S.activities.studioTree.phases`)
- Test: `packages/web/test/activities-workspace-model.test.ts`, `packages/web/test/activities-studio-tree.test.ts`

**Interfaces:**
- Produces: `type StudioPhase = "write" | "media" | "build" | "more"`; `STUDIO_PHASES: readonly StudioPhase[]`; `phaseOf(section: Exclude<WorkspaceSection, "newRef">): StudioPhase` (workspace-model); `phaseOfNode(node: StudioNode): StudioPhase | null` (studio-tree).

- [ ] **Step 1: Failing tests.** In `activities-workspace-model.test.ts`, change the first "workspace sections" case's expected order and add a phase case:

```ts
  it("lists sections in phase order", () => {
    expect(workspaceSections(full).map((entry) => entry.key)).toEqual([
      "description", "specification", "features",
      "scenes", "speech", "library",
      "module", "configuration", "assessment", "deploy",
      "stats", "history",
      "newRef",
    ]);
  });

  it("puts every rail section in exactly one phase, in phase order", () => {
    const rail = workspaceSections(full).filter((entry) => entry.key !== "newRef");
    const phases = rail.map((entry) => phaseOf(entry.key as Exclude<WorkspaceSection, "newRef">));
    expect(phases).toEqual([
      "write", "write", "write",
      "media", "media", "media",
      "build", "build", "build", "build",
      "more", "more",
    ]);
    expect(STUDIO_PHASES).toEqual(["write", "media", "build", "more"]);
  });
```
In `activities-studio-tree.test.ts`, add:
```ts
  it("orders top-level rows by phase and names each row's phase", () => {
    const nodes = buildStudioTree(workspaceSections(full), emptyScenes);
    expect(nodes.map((node) => phaseOfNode(node))).toEqual([
      "write", "write", "write",
      "media", "media", "media",
      "build", "build", "build", "build",
      "more", "more",
    ]);
  });
```
(Reuse the file's existing `full` state and empty scene tree fixture — read the top of the test file for their names.)

Run: `pnpm --filter @prismshadow/penguin-web exec vitest run test/activities-workspace-model.test.ts test/activities-studio-tree.test.ts`
Expected: FAIL — `phaseOf`/`phaseOfNode` not exported; order differs.

- [ ] **Step 2: Model.** Reorder the array in `workspaceSections` (keep each entry's comment and `enabled` rule, move them): description, specification, features, scenes, speech, library, module, configuration, assessment, deploy, stats, history, newRef. Then add:

```ts
/** The rail's phases, top to bottom: what an author does first sits first. */
export type StudioPhase = "write" | "media" | "build" | "more";
export const STUDIO_PHASES: readonly StudioPhase[] = ["write", "media", "build", "more"];

const PHASE_OF: Record<Exclude<WorkspaceSection, "newRef">, StudioPhase> = {
  description: "write",
  specification: "write",
  features: "write",
  scenes: "media",
  speech: "media",
  library: "media",
  module: "build",
  configuration: "build",
  assessment: "build",
  deploy: "build",
  stats: "more",
  history: "more",
};

export function phaseOf(section: Exclude<WorkspaceSection, "newRef">): StudioPhase {
  return PHASE_OF[section];
}
```

- [ ] **Step 3: Tree order and phase.** In `studio-tree.ts` reorder L145-158 to:
```ts
    sectionRow("script", "activityScript", "description", sections),
    sectionRow("spec", "activitySpec", "specification", sections),
    sectionRow("features", "implementationFeatures", "features", sections),
    sectionRow("scenes", "scenes", "scenes", sections, sceneRows),
    sectionRow("audios", "audios", "speech", sections),
    sectionRow("library", "mediaLibrary", "library", sections),
    sectionRow("module", "moduleDefinition", "module", sections),
    sectionRow("configuration", "configurationData", "configuration", sections),
    sectionRow("assessment", "assessmentData", "assessment", sections),
    sectionRow("deploy", "deploy", "deploy", sections),
    sectionRow("stats", "activityStats", "stats", sections),
    sectionRow("history", "history", "history", sections),
```
and export:
```ts
/** The phase a top-level row sits under; null for rows that are not sections. */
export function phaseOfNode(node: StudioNode): StudioPhase | null {
  const target = node.target;
  if (!target || target.kind !== "section" || target.section === "newRef") return null;
  return phaseOf(target.section);
}
```
(import `phaseOf`, `type StudioPhase` from `./workspace-model`).

- [ ] **Step 4: Strings and view.** Strings (`studioTree`): `phases: { write: "Write", media: "Media", build: "Build & ship", more: "More" },` and type `phases: { write: string; media: string; build: string; more: string };`. In `studio-tree-view.tsx`, where top-level nodes are mapped (`nodes.map((node) => row(node, 0))`), insert a label before the first node of each phase:

```tsx
{nodes.map((node, index) => {
  const phase = phaseOfNode(node);
  const starts = phase !== null && phase !== phaseOfNode(nodes[index - 1] ?? node) || (index === 0 && phase !== null);
  return (
    <Fragment key={node.id}>
      {starts && (
        <li role="none" aria-hidden
          className="px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 first:pt-1 dark:text-gray-500">
          {S.activities.studioTree.phases[phase!]}
        </li>
      )}
      {row(node, 0)}
    </Fragment>
  );
})}
```
(The label is `aria-hidden`: a tree's children must be treeitems; the rows keep their own names, so assistive tech loses only the visual grouping.) Import `Fragment` from react and `phaseOfNode` from `./studio-tree`.

- [ ] **Step 5: Run — pass; update presets test if it depends on order**

Run: `pnpm --filter @prismshadow/penguin-web test` — Expected: all pass. If `activities-layout-presets.test.ts` asserts a section order, update it to the new order.

- [ ] **Step 6: e2e.** Run `pnpm --filter @prismshadow/penguin-web test:e2e -- activities.spec.mjs`. Tests that count treeitems (L1685-1712) are unaffected (labels are not treeitems); fix any that assumed "Module Definition" sits before "Scenes" by position.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src packages/web/test packages/web/e2e
git commit -m "feat(activities): group the studio rail by phase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: The app sidebar steps back inside an activity

**Files:**
- Create: `packages/web/src/lib/sidebar-auto-collapse.ts`
- Modify: `packages/web/src/components/layout/app-layout.tsx:435-472`
- Test: `packages/web/test/sidebar-auto-collapse.test.ts`

**Interfaces:**
- Produces: `wantsFocus(pathname: string): boolean`; `effectiveCollapsed(stored: boolean, focus: boolean, override: boolean | null): boolean`.

- [ ] **Step 1: Failing test**

```ts
// packages/web/test/sidebar-auto-collapse.test.ts
import { describe, expect, it } from "vitest";
import { effectiveCollapsed, wantsFocus } from "../src/lib/sidebar-auto-collapse";

describe("sidebar auto-collapse", () => {
  it("focuses an open activity only", () => {
    expect(wantsFocus("/activities/abc")).toBe(true);
    expect(wantsFocus("/activities/abc/")).toBe(true);
    expect(wantsFocus("/activities")).toBe(false);
    expect(wantsFocus("/activities/media")).toBe(false);
    expect(wantsFocus("/agents/abc")).toBe(false);
  });
  it("collapses in focus unless the user expanded it there", () => {
    expect(effectiveCollapsed(false, true, null)).toBe(true);
    expect(effectiveCollapsed(false, true, false)).toBe(false);
    expect(effectiveCollapsed(true, true, null)).toBe(true);
  });
  it("uses the stored preference outside focus, whatever happened inside", () => {
    expect(effectiveCollapsed(false, false, false)).toBe(false);
    expect(effectiveCollapsed(true, false, null)).toBe(true);
  });
});
```
Run: `pnpm --filter @prismshadow/penguin-web exec vitest run test/sidebar-auto-collapse.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement**

```ts
// packages/web/src/lib/sidebar-auto-collapse.ts
/**
 * An open activity is a workspace: the app sidebar steps back to its rail so the studio
 * has the width. The user's stored preference is never written by this; an expand inside
 * the workspace lasts until they leave it.
 */
const FOCUS = /^\/activities\/(?!media\/?$)[^/]+\/?$/;

export function wantsFocus(pathname: string): boolean {
  return FOCUS.test(pathname);
}

/** `override` is what the user chose inside the workspace this visit, or null. */
export function effectiveCollapsed(
  stored: boolean,
  focus: boolean,
  override: boolean | null,
): boolean {
  if (!focus) return stored;
  return override ?? true;
}
```

- [ ] **Step 3: Wire `app-layout.tsx`.** Replace L435-444 with:
```tsx
const [storedCollapsed, setStoredCollapsed] = useState(
  () => localStorage.getItem("penguin.sidebarCollapsed") === "1",
);
const { pathname } = useLocation();
const focus = wantsFocus(pathname);
const [override, setOverride] = useState<boolean | null>(null);
// Leaving the workspace forgets what was chosen inside it.
useEffect(() => {
  if (!focus) setOverride(null);
}, [focus]);
const collapsed = effectiveCollapsed(storedCollapsed, focus, override);
const toggleCollapsed = () => {
  if (focus) return setOverride(!collapsed);
  setStoredCollapsed((v) => {
    const next = !v;
    localStorage.setItem("penguin.sidebarCollapsed", next ? "1" : "0");
    return next;
  });
};
```
(`useLocation` is already imported at L8; import `useEffect` if not, and `effectiveCollapsed, wantsFocus` from `../../lib/sidebar-auto-collapse`.) L460-472 keep reading `collapsed`.

- [ ] **Step 4: Run tests, typecheck, e2e layout**

Run: `pnpm --filter @prismshadow/penguin-web test` — Expected: pass.
Run: `pnpm --filter @prismshadow/penguin-web typecheck` — Expected: exit 0.
Run: `pnpm --filter @prismshadow/penguin-web test:e2e -- layout.spec.mjs activities.spec.mjs` — Expected: pass. Any activities test that clicks the full sidebar (project switcher, session list) while on `/activities/:id` must first click the rail's expand button (`CollapsedRail`'s `onExpand` button — use its accessible name).

- [ ] **Step 5: Add an e2e for the Review Focus #4 case** in `layout.spec.mjs`:
```js
test("an activity collapses the sidebar without changing the stored choice", async ({ page }) => {
  // setup: sidebar expanded (default), an activity exists (reuse activities.spec helpers or create via API)
  await page.goto(`/activities/${activityId}`);
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeHidden();
  await page.goto("/agents");
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("penguin.sidebarCollapsed"))).not.toBe("1");
});
```
Run it — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src packages/web/test packages/web/e2e
git commit -m "feat(layout): the app sidebar steps back while an activity is open

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Panel tabs in the studio header

**Files:**
- Modify: `packages/web/src/features/activities/activity-workspace.tsx:124-127,243-246,303-366`
- Modify: `packages/web/src/features/activities/workspace-model.ts` (remove `STUDIO_RAIL_WIDTH`)
- Modify: `strings-en.ts` (`studioPanels.names.conversation: "Chat"`, `sessions: "Sessions"`, `rail: "Activity panels"` stays as the tab group's label)
- Test: `packages/web/test/activities-workspace-model.test.ts` (if it references `STUDIO_RAIL_WIDTH`), `packages/web/e2e/activities.spec.mjs`

**Interfaces:**
- Consumes: `StudioPanelEntry` (unchanged: `{ key, label, icon, render }`), `STUDIO_PANELS`, `SIDE_PANEL_WIDTH`.
- Produces: no new exports; the icon rail `<nav>` is gone; tabs render inside the header row.

- [ ] **Step 1: Header tabs.** After `{layoutState && <LayoutMenu … />}` at L245 add:
```tsx
{panels.length > 0 && (
  <div role="group" aria-label={S.activities.studioPanels.rail}
    className="flex items-center gap-0.5 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800">
    {panels.map((entry) => (
      <button key={entry.key} type="button" aria-pressed={panel === entry.key}
        onClick={() => choosePanel(entry.key)}
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
          panel === entry.key
            ? "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100"
            : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        }`}>
        <GlyphIcon d={entry.icon} size={14} />
        <span className="hidden sm:inline">{entry.label}</span>
        <span className="sr-only sm:hidden">{entry.label}</span>
      </button>
    ))}
  </div>
)}
```
- [ ] **Step 2: Remove the icon rail** (`{panels.length > 0 && (<nav …>…</nav>)}`, L330-366). In the width reservation (L124-127) change `STUDIO_RAIL_WIDTH + (openPanel && sideBeside ? SIDE_PANEL_WIDTH : 0)` to `openPanel && sideBeside ? SIDE_PANEL_WIDTH : 0`. In the overlay style (L306) drop `right: ${STUDIO_RAIL_WIDTH}px` → `...(sideBeside ? {} : { right: 0 })`. Delete `STUDIO_RAIL_WIDTH` from `workspace-model.ts` and every import (`rg -n STUDIO_RAIL_WIDTH packages/web`).
- [ ] **Step 3: Rename labels** in `strings-en.ts` L140-150: `conversation: "Chat"`, `sessions: "Sessions"`.
- [ ] **Step 4: Update e2e.** In `activities.spec.mjs`: buttons found by name "Conversation" (L3187, 3251) → "Chat"; complementary regions named "Conversation" (L3188, 3252 and any other) → "Chat"; "Agent sessions" → "Sessions". The panel buttons are now `aria-pressed` toggle buttons in the header — same role, so `getByRole("button", { name })` still works. Run: `rg -n '"Conversation"|"Agent sessions"' packages/web/e2e` — Expected after edits: no output.
- [ ] **Step 5: Verify**

Run: `pnpm --filter @prismshadow/penguin-web test && pnpm --filter @prismshadow/penguin-web typecheck` — Expected: pass.
Run: `pnpm --filter @prismshadow/penguin-web test:e2e -- activities.spec.mjs` — Expected: pass.
Look at the studio at desktop width and 375px: tabs visible in the header, panel opens beside the editor on desktop and over it on a phone.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src packages/web/test packages/web/e2e
git commit -m "feat(activities): panel tabs in the studio header replace the icon rail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: A run's transcript opens inside Sessions

**Files:**
- Create: `packages/web/src/features/activities/run-transcript.tsx`
- Modify: `packages/web/src/features/activities/sessions-panel.tsx`
- Modify: `strings-en.ts` / `strings-types.ts` (`studioPanels.showTranscript`, `hideTranscript`, `openFullPage`)
- Test: `packages/web/e2e/activities.spec.mjs`

**Interfaces:**
- Consumes: `useSessionTranscript(sessionId, initialStatus)` from `./use-session-transcript` (returns `{ stream, running, ctx, items, older, error, setError }`), `MessageStream` from `../chat/message-stream`.
- Produces: `RunTranscript({ sessionId, running }: { sessionId: string; running: boolean })`.

- [ ] **Step 1: Strings**
```ts
// studioPanels
showTranscript: "Show",
hideTranscript: "Hide",
openFullPage: "Open full page",
```
(types: `showTranscript: string; hideTranscript: string; openFullPage: string;`). `openSession` is no longer used — remove it from both files.

- [ ] **Step 2: The transcript view** (read-only: generation runs are driven by their stage, not by typing)

```tsx
// packages/web/src/features/activities/run-transcript.tsx
/**
 * One run's session, read in place: the same transcript the chat page shows, without
 * leaving the activity. Approvals still work — they are part of the stream.
 */
import { MessageStream } from "../chat/message-stream";
import { useSessionTranscript } from "./use-session-transcript";

export function RunTranscript({ sessionId, running }: { sessionId: string; running: boolean }) {
  const { stream, ctx, items, older, error } = useSessionTranscript(
    sessionId,
    running ? "running" : "idle",
  );
  return (
    <div className="max-h-[28rem] min-h-40 overflow-y-auto border-t border-gray-200 dark:border-gray-800">
      <MessageStream
        items={items}
        version={stream.version}
        ctx={ctx}
        older={older}
        onAddExcerpt={() => {}}
      />
      {(error ?? stream.error) && (
        <p role="alert" className="px-4 py-2 text-xs text-red-600 dark:text-red-400">
          {error ?? stream.error}
        </p>
      )}
    </div>
  );
}
```
(If `stream.error` is not a string, render it the way `conversation-panel.tsx:326-328` does.)

- [ ] **Step 3: Sessions panel.** Replace the `<Link …>{openSession}</Link>` per row with a toggle, and show the transcript under the open row:
```tsx
export function SessionsPanel({ runs }: { runs: readonly ActivityRunSummary[] }) {
  const words = S.activities.studioPanels;
  const sessions = sessionRuns(runs);
  const [open, setOpen] = useState<string | null>(null);
  if (!sessions.length) return <EmptyState title={words.sessionsEmpty} />;
  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-800">
      {sessions.map((run) => (
        <li key={run.runId}>
          <div className="flex items-center gap-3 px-4 py-2.5">
            {/* the existing dot + title/status spans, unchanged */}
            <button type="button" aria-expanded={open === run.runId}
              onClick={() => setOpen((current) => (current === run.runId ? null : run.runId))}
              className="shrink-0 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-300">
              {open === run.runId ? words.hideTranscript : words.showTranscript}
            </button>
          </div>
          {open === run.runId && (
            <>
              <RunTranscript sessionId={run.sessionId!} running={run.status === "running"} />
              <Link to={`/chat/${encodeURIComponent(run.sessionId!)}`}
                className="block px-4 py-2 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                {words.openFullPage} ↗
              </Link>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
```
(EmptyState was introduced here in Task 3; keep it.)

- [ ] **Step 4: e2e.** Find the test that opens the sessions panel (search `"Agent sessions"` history, now `"Sessions"`) and change its "Open" click to:
```js
await panel.getByRole("button", { name: "Show" }).first().click();
await expect(panel.getByRole("link", { name: /Open full page/ })).toBeVisible();
await expect(page).toHaveURL(/\/activities\//);
```
Run: `pnpm --filter @prismshadow/penguin-web test:e2e -- activities.spec.mjs` — Expected: pass.

- [ ] **Step 5: Typecheck, commit**

```bash
pnpm --filter @prismshadow/penguin-web typecheck
git add packages/web/src packages/web/e2e
git commit -m "feat(activities): read a run's session without leaving the studio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Breadcrumb header with a running chip

**Files:**
- Modify: `packages/web/src/features/activities/activities-page.tsx:1181-1257`
- Modify: `strings-en.ts` / `strings-types.ts` (`S.activities.breadcrumb`, `S.activities.runningChip`)
- Test: `packages/web/e2e/activities.spec.mjs`

**Interfaces:**
- Consumes: `runTitle` (sessions-panel), `runs` state, `toneDot`, `toneInk`.

- [ ] **Step 1: Strings**
```ts
breadcrumb: "Breadcrumb",
runningChip: (what: string) => `${what} running`,
```
Keep `backToActivities: "All activities"` — it becomes the first crumb's text, so e2e selectors `getByRole("link", { name: "All activities" })` keep working.

- [ ] **Step 2: Replace the header block** (the `<Link to="/activities" … underline …>` and the `<div className="min-w-0 flex-1">…</div>` that follows) with:
```tsx
<nav aria-label={S.activities.breadcrumb} className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
  <Link to="/activities" className="shrink-0 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
    {S.activities.backToActivities}
  </Link>
  <span aria-hidden className="text-gray-300 dark:text-gray-600">/</span>
  <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">{detail.productCode}</span>
  <span aria-hidden className="text-gray-300 dark:text-gray-600">/</span>
  <h2 className="truncate font-semibold" title={detail.title}>{detail.title}</h2>
  <RefSwitcher /* all existing props, unchanged */ />
  {runningRun && (
    <span className={`ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/20 px-2 py-0.5 text-xs ${toneInk.busy}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${toneDot.busy}`} />
      {S.activities.runningChip(runTitle(runningRun.kind))}
    </span>
  )}
</nav>
```
with `const runningRun = runs.find((run) => run.status === "running");` above. Keep the collection line only as the `title` attribute of the product code span (`title={\`${S.activities.collection}: ${detail.collectionId}\`}`); keep the dirty/draft-status `<p aria-live>` and the Reload button as they are.

- [ ] **Step 3: Verify.** Run: `pnpm --filter @prismshadow/penguin-web typecheck` and `pnpm --filter @prismshadow/penguin-web test:e2e -- activities.spec.mjs` — Expected: pass (the "All activities" link keeps its name; tests that read the title via `heading` still find an `h2`). Look at the studio at desktop and 375px: the crumb truncates the title, never wraps the chip under it at desktop width.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src packages/web/e2e
git commit -m "feat(activities): breadcrumb header with the running stage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Slice 4 — Links to the rest of the app

### Task 13: Sessions know their activity (server)

**Files:**
- Modify: `packages/server/src/mechanisms/sessions.ts:14` (`SessionIndex` interface: two methods)
- Modify: `packages/server/src/db/repos/sessions.ts` (`SessionsRepo`: implement them)
- Modify: `packages/server/src/services/session-service.ts:95-108,124-155,232-290` (deps + `toInfo` + `listSessions`)
- Modify: `packages/server/src/runtime/session-manager.ts:2423-2443` (wire the lambdas)
- Modify: `packages/server/src/api/types.ts:~1442` (`SessionInfo.activityId?`)
- Test: `packages/server/test/session-activity-id.test.ts`

**Interfaces:**
- Produces: `SessionInfo.activityId?: string`; `SessionIndex.activityIdsOfProject(projectId: string): Map<string, string>` (sessionId → activityId); `SessionIndex.activityIdOfSession(sessionId: string): string | undefined`.

- [ ] **Step 1: Failing test** (a repo-level test over a real test DB; follow how other repo tests build a `Db` — `rg -ln "new SessionsRepo|SessionsRepo" packages/server/test` and copy that setup)

```ts
// packages/server/test/session-activity-id.test.ts
import { describe, expect, it } from "vitest";
// setup imports: copy from an existing SessionsRepo / db test

describe("session -> activity", () => {
  it("maps a project's activity-run sessions to their activity, and nothing else", () => {
    const { repo, db } = setup(); // copied fixture: a Db with the schema, and SessionsRepo over it
    const insert = db.prepare(
      "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    // projects/activities rows first if foreign keys demand them (copy from activity tests)
    insert.run("run_1", "p1", "act_1", "succeeded", "2026-09-28", "spec", JSON.stringify({ sessionId: "s1" }));
    insert.run("run_2", "p1", "act_1", "succeeded", "2026-09-28", "audio", JSON.stringify({ sessionId: null }));
    insert.run("run_3", "p2", "act_9", "succeeded", "2026-09-28", "spec", JSON.stringify({ sessionId: "s9" }));
    expect([...repo.activityIdsOfProject("p1")]).toEqual([["s1", "act_1"]]);
    expect(repo.activityIdOfSession("s1")).toBe("act_1");
    expect(repo.activityIdOfSession("s-unknown")).toBeUndefined();
    expect(repo.activityIdsOfProject("p1").has("s9")).toBe(false);
  });
});
```
Run: `pnpm --filter @prismshadow/penguin-server exec vitest run test/session-activity-id.test.ts` — Expected: FAIL (methods missing).

- [ ] **Step 2: Implement in `SessionsRepo`** (and declare both in `SessionIndex`'s `Interface<{…}>`):
```ts
  /**
   * Every activity-run session of a Project, session id -> activity id, in one query, so a
   * session list can stamp `activityId` without a lookup per row. An activity run keeps its
   * session id inside its record; runs without a session (deterministic stages) have null.
   */
  activityIdsOfProject(projectId: string): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT json_extract(record_json, '$.sessionId') AS session_id, activity_id
           FROM activity_runs
          WHERE project_id = ? AND json_extract(record_json, '$.sessionId') IS NOT NULL`,
      )
      .all(projectId) as Array<{ session_id: string; activity_id: string }>;
    return new Map(rows.map((row) => [row.session_id, row.activity_id]));
  }

  activityIdOfSession(sessionId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT activity_id FROM activity_runs
          WHERE json_extract(record_json, '$.sessionId') = ? LIMIT 1`,
      )
      .get(sessionId) as { activity_id: string } | undefined;
    return row?.activity_id;
  }
```
- [ ] **Step 3: Thread through `SessionService`** exactly as `orgId` is: add to `SessionServiceDeps`
```ts
  /** The activity whose run a Session is, for `SessionInfo.activityId` (see orgIdOfSession). */
  activityIdOfSession?: (sessionId: string) => string | undefined;
  activityIdsOfProject?: (projectId: string) => ReadonlyMap<string, string>;
```
`toInfo(row, hasTrace, orgIds?, activityIds?)`: `const activityId = activityIds ? activityIds.get(row.sessionId) : this.deps.activityIdOfSession?.(row.sessionId);` and spread `...(activityId !== undefined ? { activityId } : {})` after `orgId`. In `listSessions` beside L255: `const activityIds = this.deps.activityIdsOfProject?.(projectId) ?? new Map<string, string>();` and pass it at L284: `this.toInfo(row, rowHasTrace(row), orgIds, activityIds)`. In `session-manager.ts` after `orgIdsOfProject` (L2441):
```ts
      activityIdOfSession: (sessionId) => sessionsRepo.activityIdOfSession(sessionId),
      activityIdsOfProject: (projectId) => sessionsRepo.activityIdsOfProject(projectId),
```
`api/types.ts` beside `orgId?: string;`: `/** The activity whose generation run this Session is; absent for every other Session. */ activityId?: string;`
- [ ] **Step 4: Run — pass; full server suite; typecheck**

Run: `pnpm --filter @prismshadow/penguin-server test` — Expected: new test passes; only the known pre-existing failures remain.
Run: `pnpm --filter @prismshadow/penguin-server typecheck` — Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src packages/server/test/session-activity-id.test.ts
git commit -m "feat(sessions): a session names the activity whose run it is

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Runs leave the sidebar; chat links back; notifications and home refresh

**Files:**
- Create: `packages/web/src/lib/activity-sessions.ts`
- Modify: `packages/web/src/components/layout/sidebar.tsx:436`
- Modify: `packages/web/src/features/chat/chat-page.tsx:~1878-1900` (banner after the toolbar)
- Modify: `packages/web/src/state/use-completion-notifications.ts:61-72`
- Modify: `packages/web/src/features/activities/activities-page.tsx` (list reload on run-session settle)
- Modify: strings (`S.chat.partOfActivity`, `S.chat.backToActivity`)
- Test: `packages/web/test/activity-sessions.test.ts`

**Interfaces:**
- Consumes: `SessionInfo.activityId` (Task 13).
- Produces: `withoutActivityRuns(sessions: readonly SessionInfo[]): SessionInfo[]`; `sessionHref(session: Pick<SessionInfo, "sessionId" | "activityId">): string`; `settledActivityRuns(before: ReadonlyMap<string, string>, sessions: readonly SessionInfo[]): boolean` (true when any activity-run session went from running/compacting to anything else).

- [ ] **Step 1: Failing test**

```ts
// packages/web/test/activity-sessions.test.ts
import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { sessionHref, settledActivityRuns, withoutActivityRuns } from "../src/lib/activity-sessions";

const s = (sessionId: string, status: string, activityId?: string) =>
  ({ sessionId, status, ...(activityId ? { activityId } : {}) }) as unknown as SessionInfo;

describe("activity sessions", () => {
  it("drops activity-run sessions from the global list", () => {
    expect(withoutActivityRuns([s("a", "idle"), s("b", "idle", "act")]).map((x) => x.sessionId)).toEqual(["a"]);
  });
  it("opens an activity run at its activity, anything else in chat", () => {
    expect(sessionHref({ sessionId: "b", activityId: "act 1" })).toBe("/activities/act%201");
    expect(sessionHref({ sessionId: "a/1" })).toBe("/chat/a%2F1");
  });
  it("notices an activity run finishing, not an ordinary session", () => {
    const before = new Map([["a", "running"], ["b", "running"]]);
    expect(settledActivityRuns(before, [s("a", "idle"), s("b", "running", "act")])).toBe(false);
    expect(settledActivityRuns(before, [s("a", "running"), s("b", "idle", "act")])).toBe(true);
  });
});
```
Run: `pnpm --filter @prismshadow/penguin-web exec vitest run test/activity-sessions.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement**

```ts
// packages/web/src/lib/activity-sessions.ts
/**
 * Sessions that are an activity's generation runs belong to that activity: they live in
 * its studio, not in the global session list, and opening one goes back to the activity.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";

export function withoutActivityRuns(sessions: readonly SessionInfo[]): SessionInfo[] {
  return sessions.filter((session) => session.activityId === undefined);
}

export function sessionHref(session: Pick<SessionInfo, "sessionId" | "activityId">): string {
  return session.activityId !== undefined
    ? `/activities/${encodeURIComponent(session.activityId)}`
    : `/chat/${encodeURIComponent(session.sessionId)}`;
}

const LIVE = new Set(["running", "compacting"]);

/** `before` is sessionId -> the status last seen. */
export function settledActivityRuns(
  before: ReadonlyMap<string, string>,
  sessions: readonly SessionInfo[],
): boolean {
  return sessions.some(
    (session) =>
      session.activityId !== undefined &&
      LIVE.has(before.get(session.sessionId) ?? "") &&
      !LIVE.has(session.status),
  );
}
```
Run the test — Expected: 3 passed.

- [ ] **Step 3: Wire.**
  - Sidebar L436: `const sessions = useMemo(() => withoutActivityRuns(withoutOrgSessions(allSessions)), [allSessions]);`
  - Notification click (`use-completion-notifications.ts` L72): replace `navigateRef.current(\`/chat/${sessionId}\`)` with `navigateRef.current(sessionHref(session))`, where `session` is the `SessionInfo` the title came from (the hook already reads `sessions` from `useSessions()`; find it by id).
  - Chat banner (`chat-page.tsx`, directly after the toolbar `</div>` that follows `{selected && (`):
```tsx
{selected?.activityId !== undefined && (
  <div className={`flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs md:px-4 ${toneStrip.muted}`}>
    <span>{S.chat.partOfActivity}</span>
    <Link to={`/activities/${encodeURIComponent(selected.activityId)}`} className="font-medium underline">
      {S.chat.backToActivity}
    </Link>
  </div>
)}
```
(strings: `partOfActivity: "This session is an activity's generation run."`, `backToActivity: "Back to the activity"`; types accordingly. Import `toneStrip` from `../../lib/tone`.)
  - Home refresh (`activities-page.tsx`, in the component that owns `reload` for the list): 
```tsx
const { sessions } = useSessions();
const seen = useRef(new Map<string, string>());
useEffect(() => {
  if (!activityId && settledActivityRuns(seen.current, sessions)) void reload();
  seen.current = new Map(sessions.map((session) => [session.sessionId, session.status]));
}, [sessions, activityId, reload]);
```
- [ ] **Step 4: Verify**

Run: `pnpm --filter @prismshadow/penguin-web test && pnpm --filter @prismshadow/penguin-web typecheck` — Expected: pass.
Run: `pnpm --filter @prismshadow/penguin-web test:e2e -- activities.spec.mjs layout.spec.mjs` — Expected: pass. Any e2e that found a run in the global sidebar must now find it in the studio's Sessions tab.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src packages/web/test packages/web/e2e
git commit -m "feat(activities): runs live in their activity, chat and notifications lead back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Activities in the quick switcher

**Files:**
- Modify: `packages/web/src/lib/quick-switcher.ts:14,17,47` (new section + builder)
- Modify: `packages/web/src/components/layout/quick-switcher.tsx:~129`
- Modify: strings (`S.quickSwitcher.sections.activities` or the file's existing section-title key — read how "pages"/"agents" section titles are named)
- Test: the existing quick-switcher test (`rg -l "buildPageEntries" packages/web/test`)

**Interfaces:**
- Produces: `SwitcherEntrySection` gains `"activities"`; `buildActivityEntries(items: ReadonlyArray<{ id: string; title: string; productCode: string; refNum: number }>): SwitcherEntry[]`.

- [ ] **Step 1: Failing test** (add to the existing quick-switcher test file)
```ts
it("builds one entry per activity, detail is product and ref", () => {
  expect(buildActivityEntries([{ id: "a1", title: "Counting ants", productCode: "ants", refNum: 3 }])).toEqual([
    { id: "activity:a1", section: "activities", title: "Counting ants", detail: "ants / 3", to: "/activities/a1", routeState: null, busy: null },
  ]);
});
```
Run the file — Expected: FAIL.

- [ ] **Step 2: Implement** in `quick-switcher.ts`: `export type SwitcherEntrySection = "pages" | "agents" | "activities";`, append `"activities"` to `SWITCHER_SECTIONS`, and:
```ts
export function buildActivityEntries(
  items: ReadonlyArray<{ id: string; title: string; productCode: string; refNum: number }>,
): SwitcherEntry[] {
  return items.map((item) => ({
    id: `activity:${item.id}`,
    section: "activities",
    title: item.title,
    detail: `${item.productCode} / ${item.refNum}`,
    to: `/activities/${encodeURIComponent(item.id)}`,
    routeState: null,
    busy: null,
  }));
}
```
Update the `id` doc comment to list `activity:<id>`. In `quick-switcher.tsx`, when the switcher opens, fetch `apiFetch<{ activities: ActivityRecord[] }>(\`/api/projects/${encodeURIComponent(projectId)}/activities\`)` once per open (no `summary=1`), ignore errors (a project without activities access shows none), and concatenate `buildActivityEntries(result.activities)`. Add the section's title string beside the existing ones.
- [ ] **Step 3: Run tests, typecheck; commit**

```bash
pnpm --filter @prismshadow/penguin-web test && pnpm --filter @prismshadow/penguin-web typecheck
git add packages/web/src packages/web/test
git commit -m "feat(switcher): jump to an activity from the quick switcher

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: `/activities/media` is a route

**Files:**
- Modify: `packages/web/src/module.json:31-40` (second page entry)
- Modify: `packages/web/src/features/activities/activities-page.tsx:145-146,204-205,249`
- Test: `packages/web/e2e/activities.spec.mjs`

- [ ] **Step 1: Add the page entry** after the activities entry in `module.json`:
```json
{
  "id": "web.activities-media",
  "key": "activities-media",
  "path": "/activities/media",
  "nav": "none",
  "admin": false,
  "released": true,
  "renderer": { "builtin": "ActivitiesPage" }
}
```
(Match the exact field set of the existing entry; if `nav: "none"` is not an accepted value, read `lib/pages.ts` for the non-nav value.) React Router ranks the static `/activities/media` above `/activities/:activityId?`.
- [ ] **Step 2: Page.** `const media = useMatch("/activities/media") !== null;` (import `useMatch`). Replace `if (!activityId && searchParams.get("view") === "media")` with:
```tsx
if (!activityId && searchParams.get("view") === "media") return <Navigate to="/activities/media" replace />;
if (media) return <ProjectMediaView projectId={projectId} available={available} />;
```
and `onMedia={() => navigate("/activities/media")}`.
- [ ] **Step 3: e2e.** Replace `?view=media` URLs in `activities.spec.mjs` (`rg -n "view=media" packages/web/e2e`) with `/activities/media`, and add `await page.goto("/activities?view=media"); await expect(page).toHaveURL(/\/activities\/media$/);`. Run the spec — Expected: PASS. Also confirm Task 9's `wantsFocus("/activities/media")` is false (already tested).
- [ ] **Step 4: Typecheck; commit**

```bash
pnpm --filter @prismshadow/penguin-web typecheck
git add packages/web/src packages/web/e2e
git commit -m "feat(activities): project media at its own route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: The deploy notice opens Settings on Deploy

**Files:**
- Create: `packages/web/src/lib/settings-dialog-store.ts`
- Modify: `packages/web/src/components/layout/user-menu.tsx:55,101,136`
- Modify: `packages/web/src/features/settings/settings-dialog.tsx:63-80`
- Modify: `packages/web/src/features/activities/deploy-panel.tsx:262-264`
- Modify: strings (`deploy.openSettings: "Open deploy settings"`)
- Test: `packages/web/test/settings-dialog-store.test.ts`

**Interfaces:**
- Produces: `settingsDialog` vanilla store with `open(section?: SettingsSectionKey)`, `close()`, state `{ isOpen: boolean; section: SettingsSectionKey | null }`; `useSettingsDialog()` hook; `SettingsDialog` gains `initialSection?: SettingsSectionKey | null`.

- [ ] **Step 1: Failing test**
```ts
// packages/web/test/settings-dialog-store.test.ts
import { describe, expect, it } from "vitest";
import { createSettingsDialogStore } from "../src/lib/settings-dialog-store";

describe("settings dialog store", () => {
  it("opens on a section and forgets it on close", () => {
    const store = createSettingsDialogStore();
    store.getState().open("deploy");
    expect(store.getState()).toMatchObject({ isOpen: true, section: "deploy" });
    store.getState().close();
    expect(store.getState()).toMatchObject({ isOpen: false, section: null });
    store.getState().open();
    expect(store.getState().section).toBeNull();
  });
});
```
Run — Expected: FAIL.

- [ ] **Step 2: Implement** (pattern: `components/ui/toast.tsx:39`)
```ts
// packages/web/src/lib/settings-dialog-store.ts
/**
 * Whether the settings dialog is open, and on which section: one store so a page can send
 * the user straight to the setting it needs (the deploy panel's missing settings) instead
 * of describing where to find it.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { SettingsSectionKey } from "./settings-sections";

export interface SettingsDialogState {
  isOpen: boolean;
  section: SettingsSectionKey | null;
  open: (section?: SettingsSectionKey) => void;
  close: () => void;
}

export function createSettingsDialogStore() {
  return createStore<SettingsDialogState>((set) => ({
    isOpen: false,
    section: null,
    open: (section) => set({ isOpen: true, section: section ?? null }),
    close: () => set({ isOpen: false, section: null }),
  }));
}

export const settingsDialog = createSettingsDialogStore();

export function useSettingsDialog<T>(select: (state: SettingsDialogState) => T): T {
  return useStore(settingsDialog, select);
}
```
(Check how `toast.tsx` imports `useStore` and match it.)
- [ ] **Step 3: Wire.**
  - `user-menu.tsx`: delete the local `useState` (L55); `const isOpen = useSettingsDialog((s) => s.isOpen); const section = useSettingsDialog((s) => s.section);`; L101 → `settingsDialog.getState().open()`; L136 → `<SettingsDialog open={isOpen} initialSection={section} onClose={() => settingsDialog.getState().close()} />`.
  - `settings-dialog.tsx`: add `initialSection?: SettingsSectionKey | null` to the props; L76-78 becomes `useEffect(() => { if (open) setActive(initialSection ?? null); }, [open, initialSection]);`.
  - `deploy-panel.tsx:262-264`:
```tsx
{needsSettings(context) && (
  <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
    {words.settingsHint}
    <Button size="sm" onClick={() => settingsDialog.getState().open("deploy")}>{words.openSettings}</Button>
  </p>
)}
```
  (Only admins can see the Deploy section — `settings-sections.ts:75`. For a non-admin, `resolveSettingsSection` falls back to the first visible section; show the button only when the viewer is admin: read `isAdmin` the way `settings-sections.ts` callers do, and hide the button otherwise, leaving the hint.)
- [ ] **Step 4: Verify.** Unit test passes; typecheck; e2e: `rg -n "System settings" packages/web/e2e` — adjust nothing that clicked the user menu (it still opens). Add in `activities.spec.mjs`, in the existing deploy-settings-missing test if one exists (`rg -n "settingsHint|deploy settings" packages/web/e2e`), a click on "Open deploy settings" asserting the dialog shows the Deploy section heading.
- [ ] **Step 5: Commit**

```bash
git add packages/web/src packages/web/test packages/web/e2e
git commit -m "feat(activities): the deploy notice opens the deploy settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Finish

- [ ] Full suites: `pnpm --filter @prismshadow/penguin-server test`, `pnpm --filter @prismshadow/penguin-web test`, `pnpm typecheck` (root: gen-ifaces + all packages), `pnpm lint`, `pnpm format:check`, `pnpm --filter @prismshadow/penguin-web test:e2e`. Expected: only the known pre-existing server failures.
- [ ] Changelog: add `changelog/unreleased/2026-09-28-activities-ui-integration.md` in the style of `changelog/unreleased/2026-09-23-activity-studio-conventions.md`, listing the four slices and the seven deviations above.
- [ ] Look at the whole flow once in the running app: home → activity (sidebar steps back) → Sessions → Show transcript → Open full page → banner → back to the activity → breadcrumb → home.
