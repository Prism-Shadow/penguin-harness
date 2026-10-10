---
name: penguin-harness-frontend
description: Use when changing the PenguinHarness Web App (`packages/web`) or the shared UI package — adding or restyling any UI, picking a status colour, adding an icon, laying out a row or a form field, writing user-facing copy, building a popup or a hover-revealed panel, or making anything open, fold, resize or maximize. Covers the semantic tone tokens, the icon size/stroke/gap scale, the semantic-versus-formatting rule and the hover "?", the two-dictionary i18n contract, the portal-panel pattern, motion (every disclosure folds through `Fold`, sizes move through the theme's layout motion), and the recent owner decisions on favorites, maximized surfaces, the collapsed rail and example cards.
---

# Web App frontend conventions

`packages/web` is React 19 + Vite + Tailwind CSS 4, with no `cn`/`clsx`, no `tailwind-merge`, and no
variants library. Classes are composed with template literals, and a component's variants are a
`Record<Key, string>` next to it (`button.tsx`'s `variantClass`, `input.tsx`'s `sizeClass`). Match
that shape; do not introduce a styling dependency.

This file records the decisions that already exist so they are not re-litigated per PR. Read
`penguin-harness-dev` for the repo-wide contract (verification chain, changelog, two-repo layout).

## Status colour: pick a tone, never a palette class

`src/lib/tone.ts` is the only place a status colour is spelled. Five tones, chosen by **meaning**:

| tone | meaning | when |
| --- | --- | --- |
| `busy` | executing right now | spinners, live titles, running dots |
| `attention` | unfinished — waiting on time, a queue, or the user | hourglass glyphs, pending-approval marks, near-limit rings, warning strips |
| `success` | finished well, connected, healthy | completed badges, connected servers |
| `danger` | failed, destructive, over a limit | errors, delete affordances |
| `muted` | settled; the mark should recede | a done row's glyph |

Three maps, by the shape of the thing being coloured: `toneInk` (a glyph or a line of status text),
`toneSurface` (a tinted pill with its own text — badges), `toneDot` (the 6px state dots). A
notice that owns a row is the shared UI package's `NoticeStrip`, which takes the package's tone
names (`busy` → `success`, `link` → `info`, `muted` → `neutral`); toasts render through it.

Rules:

- **Two states may share a tone.** `busy` and `success` resolve to the same emerald on purpose. A
  tone says what a mark *means*, not which state it belongs to. Where two states share a tone,
  separate them by **shape and motion** — that is what the session list's turning hourglass and
  squeezing compress mark do, and it is legible to a reader who cannot separate hues.
- **Never make colour the only carrier.** Every status mark also names its state in an accessible
  name or in adjacent text.
- **Contrast is measured, not assumed.** The ratios in `tone.ts` are WCAG 2.x against the four
  surfaces marks actually sit on — white and gray-50 in light, and the values the default theme
  *overrides* for dark (`packages/ui/src/themes/github.css`: gray-950 is `#000000`, gray-900 is
  `#0d0d0d`, not Tailwind's stock values). Recompute if you change a tone; a graphical mark needs 3:1, and `muted` is the one tone
  allowed below it because its meaning is always already in text.
- **What is out of scope**, and must not be folded in: categorical palettes where colour is an
  identity rather than a judgement (`category-colors.ts`, `token-colors.ts`, the timeline phase
  bars, per-skill avatar tints); the terminal's chrome, which resolves light/dark in JS because a
  subtree cannot opt out of the `dark:` variant (`terminal-appearance.ts` carries its own
  `success`/`attention`/`danger`); secondary body text, which is typography; a background-only wash
  on a card section; and hover-only variants, since a tone token is the resting ink.

## Explanatory text: semantics disclose, formatting stays

Two kinds of prose, and the split decides *whether* it is disclosed.

- **Semantics** — what a section is, what a field means, what it affects, when a change takes
  effect. Read once, then in the way forever. It is disclosed on request.
- **Formatting** — the shape the value must take: "one `KEY=value` per line", "one argument per
  line", "leave empty for unlimited", allowed characters, a `k`/`m` suffix. Read *while typing*.
  It stays on screen, in the field's `hint`. Hiding it turns a glance into a click and raises the
  error rate.

A string that mixes both is a string that should be split, not a judgement call. When you cannot
split it, keep it visible — a visible sentence is never a bug, a hidden format rule is.

One exception: a rule the control already enforces or already shows goes behind the "?". The
Profile nickname's "1–32 characters, blank clears" is the case. `maxLength` stops the 33rd
character, and the placeholder says what blank means, so a visible line would only repeat them
(user decision, 2026-10-03).

Already-disclosed text does not move: `title=` tooltips, `OptionMenu` row descriptions, confirm
dialog bodies (the dialog *is* the disclosure), toasts, and empty states.

### Tooltips: when a mark gets one

A hover hint shows only where its words are not on screen (`hintAllowedFor` in the UI package's
tooltip.tsx): an icon-only control, a wordless mark, an input, or text that is cut off. Three
glyphs are read without one — the circled "?" beside a title (`InfoPopover`, whose hover opens
the explanation itself), a close or clear ×
beside the thing it dismisses, and a fold chevron under the rows it folds — so they carry no
`data-tooltip` unless the hint says something the glyph cannot: a shortcut ("Close (Esc)"), a
consequence ("Kill this terminal"), the subject when it is not beside it. That is why `DockTabs`'
close × keeps its hint (the shortcut; on a terminal tab, the consequence) while the password
banner's × and a browser tab's × have none. Either way the mark keeps its `aria-label`; that name
is for assistive technology, not a panel. A hint on text that may truncate shows that text whole
(plus an id when one helps), never the verb of the click — the underline already says it opens.

### Which disclosure — the "?" or the fold

Two forms, and **a title decides between them, not taste**:

> **The circled "?" may only appear beside a title. It must never stand alone on its own line.
> Where it would stand alone, use the fold.**

- **A title is present** → `InfoPopover` (`@prismshadow/penguin-ui`). A circled "?"
  immediately after the section heading, the table column header, or the field label — the last of
  those via `Field`/`Input`/`Textarea`/`PasswordInput`/`Select`'s `info` prop. The "?" is an
  *anchored* mark: it reads as help only because it modifies the title it sits against, and it
  borrows that title's meaning instead of restating it.
- **No title on the surface** → `HelpFold` (`@prismshadow/penguin-ui`). A compact row that
  names itself and expands its explanation inline underneath. This is the Agent settings tabs:
  their name lives in the tab bar and the panel does not repeat it, so a "?" at the top of the
  panel would be a mark modifying nothing. A neighbouring `<Button>` does not rescue it — a
  control is not a title.

The fold is **not** a popover in another shape: it is inline flow, so it takes no portal. Do not
reach for `usePortalPanel` there for symmetry — that hook exists to keep a *floating* panel clear
of an ancestor's overflow and to close it on outside click, Esc or scroll, and a fold does none of
those things. It follows the WAI-ARIA disclosure pattern instead: the panel stays in the DOM and
is `hidden` while collapsed, so its `aria-controls` always resolves.

**The "?" opens on hover** (owner, 2026-10-03: a help mark that needs a click to say anything is
one click too many). `InfoPopover` takes its behaviour from the UI package's `useHoverDisclosure`:
a mouse resting on the "?" opens the panel after the tooltip's own delay (`HOVER_OPEN_DELAY_MS`,
one hover timing in the app), leaving it closes after a short grace unless the pointer moves into
the panel, which stays open while hovered so its text can be selected and a link in it clicked. A
click pins it open (a second click, an outside click, Esc or a scroll closes it), which is also the
whole story on touch, where `pointerType` filters hover out. The keyboard toggles with Enter/Space;
focus alone opens nothing, or tabbing through a form full of "?" would spray panels. Anything new
that reveals a floating panel on hover uses the same hook rather than its own timers — and never a
`data-tooltip` on the trigger, since the panel *is* the hover content. `HelpFold` stays a click:
it is inline flow, and a fold that opened under a passing pointer would shove the page around.

Both are collapsed by default, both are real `<button>`s with `aria-expanded` and `aria-controls`,
and both fold the subject into the accessible name ("More info: Vault") rather than repeating it,
so a "?" inside a heading does not make that heading announce its own title twice. The fold's
visible text is a prefix of that name, so "label in name" holds.

`test/disclosure-anchor.test.ts` enforces the rule: it parses the real JSX with the TypeScript
parser and fails, naming file and line, on any `InfoPopover` with no title among its preceding
siblings. Extend `TITLE_ELEMENTS` there if you add a component whose job is to be a title.

**The HTML trap this forces.** A `<button>` is a labelable element, and a wrapping `<label>` names
its first labelable descendant — so a "?" nested inside `Field`'s usual `<label>` would silently
retarget the field's title from the input to the button. `Field` therefore has two layouts: without
`info` it wraps in `<label>`; with `info` it splits the title out and associates it by `htmlFor`,
which is why the control needs an id. The UI package's `test/field.test.ts` guards this.

## Icons

One renderer: `GlyphIcon` from `@prismshadow/penguin-ui`. A 24×24 path stroked at the theme's
`--ui-icon-stroke` (1.7 in Primer), `stroke="currentColor"`, `fill="none"` (or `filled` for an "on"
state); pass `decor="nav|group|menu|empty"` only where a label beside it already says what it says.
Do not hand-write an `<svg>` or a `const *_ICON = "M…"` for a line icon — the paths live in one
registry, `ICONS` (`packages/ui/src/components/icons/icons.ts`), keyed by the drawing (`robot`,
`alarmClock`), and the app's manifests say which drawing stands for what (`lib/nav-icons.ts`,
`lib/stat-icons.ts`, `GROUP_MODE_ICONS`). A new glyph is a registry entry; `test/icon-registry.test.ts`
holds the feature files' leftovers to a shrinking list.

**A glyph says what the state means, not a metaphor that happens to fit.** "Keep this out of the
fold" is a favorite: `ICONS.star`, outline when off, `filled` when on (nav entries and model groups,
owner 2026-10-03, after a lock read as permission or secrecy). A pin is a Session pinned to the top
of its list. A lock means access or secrecy and nothing else. A new glyph needs an entry in every
theme's set — the line path, an Octicon, a 16×16 pixel grid and a duotone tint — and `filled`
reads each set's filled table, so one key covers both states.

Two marks deliberately live off that grid, because a two-stroke mark aliases when its grid and its
render size disagree: `ChevronDown` (12×12, stroke 1.5) and `CloseIcon` (14×14, stroke 1.5). Charts,
sparklines, the topology view, the ring gauges and the login background draw their own geometry and
are outside the family entirely.

Sizes come from `ICON_SIZE` (`packages/ui/src/icon-scale.ts`), named by role, not by number — `inlineGlyph` 13,
`rowLead` 14, `iconButton` / `groupHeaderGlyph` 15, `navRow` / `groupHeaderAction` 16,
`groupHeaderAvatar` / `sectionMark` 18, `chevron` 14 / `chevronDense` 12, `caret` 12 /
`caretDense` 10. Pick the rung whose role matches; if none does, the honest move is to add a rung
with a sentence saying what it is for, not to type a bare number. An avatar sits one rung above a
line glyph in the same slot, because a tile fills its box and a glyph only draws inside it.

Gaps come from `ICON_GAP` in the same module and track text size: `tight` (`gap-1`) for a glyph
welded to a number, `row` (`gap-1.5`) for a list row, `menu` (`gap-2`) for menu/nav rows and
banners, `card` (`gap-3`) for a card row led by an avatar.

`test/icon-scale.test.ts` fails on a stroke weight outside the chosen set and on a second copy of
the caret, the close cross or the collapse chevron.

## Control sizes

One record: `sizeTextClass` in the UI package's `components/forms/input/input.tsx`. Two rungs —
`sm` is `text-xs`, `base` is `text-base` — and `sizeClass` pairs each with its padding. `Select`'s
menu rows, `OptionMenu`'s row titles, `Textarea` and `FormPicker` all read it, so a rung moves the
whole family at once.

The rungs are **relative, not the pixel values their names suggest**. `FONT_SCALE_PX` (in
`@prismshadow/penguin-ui/boot`, applied before first paint and by `theme.tsx`) sets the root font
size per tier (16/18/20px, default 18) and no stylesheet overrides a `--text-*`, so
`text-xs` is 13.5px at the default tier rather than 12px, and every rung tracks the user's setting.

**A call site passes `size`; it never spells a `text-*` class.** The caller's class and the
component's own rung are both single-class font-size utilities of equal specificity, so which one
wins depends on the order the CSS was generated in, not the order of classes in the string: the
built sheet emits `.text-base` before `.text-sm` before `.text-xs`, so a caller's `text-sm` silently
loses to an `sm` control's `text-xs`, and a bracket value beats all three. (`input.tsx`'s
`errorClass` meets the same hazard on the border and the focus ring and forces past it with `!`. A
font size has a `size` prop instead, so it does not need to.)

**No `text-[Npx]` on a control**: fixed px opts it out of the user's font-size setting altogether.
There is no exception: an `OptionMenu` row's description at the `sm` tier shares the `text-xs` rung
with its title (there is no rung below it) and stands apart by its muted ink (`rowDescClass`).

A form field takes `sm`: dense forms, dialogs and filter bars, which is near enough the whole app.
`base` is for a standalone page holding two controls and nothing else, and is **passed by name** —
the login card is its only caller, and an unopted `base` is what four dialog fields had drifted into.
Every control defaults to `sm` so a forgotten prop lands where its neighbours already are (the old
`base` default put it at the roomiest rung in the densest place), but **name the rung anyway** — all
112 call sites do, and the default is the safety net, not the habit. The two full-height typing
surfaces are outside the family entirely: the chat composer is `text-base` because it holds prose,
the file editor `font-mono text-xs` because it holds code.

**A button takes the rung of whatever it stands beside.** `Button` defaults to `md`
(`text-sm px-3 py-1.5`), the page rung, and that is for an action standing on its own: an empty
state's, the login card's submit, a list's "add a custom model". Wherever a button sits next to form
controls it takes theirs — `sm`:

- a `Modal` footer, on every button, as `ConfirmModal` always did. `Modal` owns the footer's wrapper
  but not the buttons inside it, so this cannot be set in one place.
- a dialog *body*, next to the fields it belongs with. The settings dialog's pages are separate
  modules and nothing in one says it renders inside a Modal, which is how four of them kept the `md`
  default and stood a rung above their own fields.
- a page header's toolbar that also holds a search box. The Models and Agents headers pair an
  `Input size="sm"` with a `size="sm"` action in the same `min-w-0 flex-1 sm:w-56 sm:flex-none`
  shape; a `md` button beside a `sm` box reads as a mistake rather than as emphasis.

`test/control-size.test.ts` parses the JSX and fails, naming file and line, on a font-size class in
a `className` passed to `Input` / `Textarea` / `Select` / `OptionMenu` / `PasswordInput` /
`FormPicker`, on a `Modal` footer Button that does not ask for `sm`, on a Button in one of the
declared dialog-body modules (`DIALOG_BODY_MODULES`, the settings dialog's pages) that does not ask
for `sm`, and on a font size spelled in a control module outside the two records. Its reach is what
a parser sees without types: a footer handed over as a component or built in a variable, and a
dialog body outside those declared modules, follow the same rule but are on you. Adding a module to
`DIALOG_BODY_MODULES` is how a new settings page joins the check.

## A button keeps its label on one line

A button's label never wraps and is never truncated. A squeezed button breaks a CJK label between
any two characters, down to one character a line, which reads as broken rather than as tight.
`Button`, `buttonClass` and `Segmented`'s options carry `whitespace-nowrap` in their base, and
`Segmented`'s columns are a bare `1fr` (`minmax(auto, 1fr)`; Tailwind's `grid-cols-N` is
`minmax(0, 1fr)`, which lets a column squeeze its label). A hand-rolled `<button>` with a text
label carries `whitespace-nowrap` itself.

Nowrap moves the pressure to the row: a button that cannot shrink pushes against its neighbours.
The layout around it makes the room, chosen per site:

- **the row wraps** — `flex-wrap` with a gap: the `Modal` foot, `ConfirmModal`, `CreateButtons`
  and `SettingsSection`'s action row do, and so does a settings row's control group that can run out
  of room at phone width (a wrapped line keeps `justify-end`);
- **the text beside it shrinks** — `min-w-0` + `truncate` on a name or a status sentence, or prose
  that wraps;
- **the button is `shrink-0`** where its neighbour can give;
- **the column widens** — fewer columns once the column itself is too narrow: a container query
  (`@container` around the grid, `@xl:grid-cols-4` on it) or
  `repeat(auto-fit, minmax(min(100%, 12rem), 1fr))`. Measure the column, not the viewport: the
  sidebar and the reader's text size both take from it.

Never let a button overflow its container or scroll the page sideways, and never truncate the
label instead. A width passed to `Input` or `Select` through `className` loses to the control's own
`w-full` (the built sheet emits `.w-full` after `.w-44`), and a full-width field beside a button is
what squeezes it: put the width on a box around the field.

The trap is a `Segmented` with long labels in a `PrefRow`: the row's control column is
`minmax(0, max-content)` and its slot is `justify-end`, so a control that no longer fits overflows
leftward over the row's label instead of wrapping. Keep such labels short, or give the options a
`shortLabel` for phone width (the full label stays the option's name), as the finance page's
period switch does.

Check a change at 390 and 1024 px with the XL text size (`penguin.textSize` = `xl`), in both
languages — that is where a row runs out of room first.

## Motion: what opens folds, what resizes moves

Components declare motion; the theme times it. Never write a duration, an easing or a keyframe in
a component — put `data-presence` / `data-reveal` / `data-layout-motion` on the element and let
`theme.css` and the theme's tokens decide (Frost long and soft, Primer short, Console in steps;
reduced motion instant). Three rules the owner has had to repeat:

- **Every disclosure body folds through `Fold`, the inner ones too.** A work group folding while the
  tool call, thinking step or settings section inside it snaps open (`{open && <div>…}`) reads as
  half a job (owner, 2026-10-03: "只有外层的有动画，里面还是没有"). `DisclosureRow`,
  `CollapsibleSection`, nav and session groups all fold; a new collapsible uses `Fold` from day one.
  A body that mounts open does not tween (a page load moves nothing), and content growing inside an
  open fold is not a transition.
- **A surface that changes size or place moves through the theme's layout motion**, with its content
  laid out at the destination size from the first frame (the dock's `contentSize`, the fullscreen
  box's anchored inner wrapper): text does not rewrap and xterm does not refit on every frame.
- **Maximize is the end of the resize range, inside the surface's own region.** The dock's full
  screen covers its row (or grows up to the toolbar), keeps the toolbar with the title and
  statistics, leaves the navigation column alone (it folds itself), and is reached by its header
  toggle or by dragging past the maximum; dragging back snaps out. No second, floating way out next
  to an in-place toggle (owner, 2026-10-03, three rounds on #961).

Check motion in motion. A resting screenshot proves nothing about a fold: slow every transition
with CDP (`Animation.enable` + `Animation.setPlaybackRate` 0.1) or pause and seek
`document.getAnimations()`, and look at the frames in between in all three themes — and walk the
interaction states a resting shot never shows (drag previews, hover hand-offs between a badge and a
toggle, nested radii, an edge painted over by a neighbour), zoomed 3–4×.

## Every user-facing string is bilingual

Two dictionaries: `src/lib/strings.ts` is zh (and defines the `Strings` type), `src/lib/strings-en.ts`
is en and is typed `const en: Strings`. That type is the whole guard: a key added to one and not
the other, or a signature that changed on one side, is a **type error** rather than a runtime
surprise. What it cannot see is whether a function-valued string uses the parameter it is handed —
`(n: number) => "items"` typechecks while the other side interpolates `n`. Add both, in the same
shape, in the same PR.

`S` is a live binding swapped on locale change, so read it at render time; never hoist `S.x.y` into
a module-level constant.

Chinese belongs only in the zh dictionary, `titleZh` fields, `*.zh.md` documents, and fixtures that
exercise CJK behaviour. Comments, test names and every other string are English.

## Popups: portal, do not absolutely position

Anything that overlays — a menu, a picker, an info popover — uses `usePortalPanel`
(`@prismshadow/penguin-ui`) and `createPortal` to `document.body`, positioned `fixed`
against viewport coordinates. An in-place absolute panel is a DOM descendant of its trigger, so any
ancestor with `overflow-x-auto` clips it vertically (the CSS spec forces the visible axis to `auto`
when the other is not visible), and auditing every call site's ancestor chain is not a plan.

Three behaviours there are load-bearing:

- **Esc uses capture and stops propagation.** `Modal` listens during the window bubble phase and
  registers earlier, so without stopping propagation one Esc would close the panel *and* the dialog.
- **Scroll uses capture**, because scroll does not bubble; the panel closes the moment its position
  would go stale rather than floating out of place. Its own internal scroll is exempted.
- **`z-[60]`**, above the modal overlay's `z-50`: a portaled node sits in the root stacking context
  and may be opened from inside a dialog.

Modals, drawers, sheets, the lightbox and `Dropdown` additionally register in the Esc-layer stack
(the UI package's `esc-layers.ts`: `useEscLayer`, or `pushEscLayer` / `isTopEscLayer`), so Escape
only acts on the topmost layer. A portal panel does not need to — capture plus `stopPropagation`
already gets there first.

A menu's rows are the package's Menu family, never a hand-built row: `Menu` (the list, `role="menu"`,
density `md` for account and project menus, `sm` for a row's overflow and context menus) holding
`MenuItem` (glyph, label, description, trailing note, `danger`, `checked`, `href`),
`MenuRadioItem`, `MenuSeparator` and `MenuLabel`. The panel around them stays a `Dropdown`. A row
outside a `Menu` is a plain button, for a panel that mixes rows with a search box or a listbox.

## The rest of the house style

- **Stacking contexts**: chrome creates none; dropdown/user menus `z-40`; modal and drawer overlays
  `z-50`; portaled panels `z-[60]`. `styles.css`'s header states this.
- **Every scroll container is a containing block** (`styles.css`, `@layer base`). Do not undo it: an
  absolutely positioned descendant of a `static` scroller escapes to the initial containing block
  and gives the whole shell a second scrollbar. That bug shipped three times.
- **Presence animations move `translate`/`scale`, never layout**, so reduced motion stills them into a
  correct resting state; size and place changes go through `data-layout-motion` (see Motion).
- **The collapsed rail carries navigation only.** No mode switch on it (the 开发 | 公司 switch lives
  in the expanded sidebar), and in company mode its top slot is the all-hands channel, not the
  development "last conversation" (owner, 2026-10-03).
- **Example and template cards show a short summary**, one line saying what it is; the full text
  (a mission, a prompt) lands in the field it fills, and examples live where the choice is made,
  not again under that field (company landing, 2026-10-03).
- **Comments explain constraints, not history**, and never cite a design doc — inline the constraint.

## Verify

```sh
pnpm --filter @prismshadow/penguin-web typecheck
pnpm --filter @prismshadow/penguin-web test
pnpm format && pnpm format:check
```

Playwright (`packages/web/e2e/`) only when selectors or flows move. On a shared machine, probe with
`ss -tln` before picking ports, and never point `PENGUIN_HOME` at `~/.penguin`.
