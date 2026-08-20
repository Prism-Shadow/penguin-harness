---
name: penguin-harness-frontend
description: Use when changing the PenguinHarness Web App (`packages/web`) — adding or restyling any UI, picking a status colour, adding an icon, laying out a row or a form field, writing user-facing copy, or building a popup. Covers the semantic tone tokens, the icon size/stroke/gap scale, the semantic-versus-formatting rule for explanatory text, the two-dictionary i18n contract, and the portal-panel pattern with its Esc and scroll caveats.
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

Four maps, by the shape of the thing being coloured: `toneInk` (a glyph or a line of status text),
`toneSurface` (a tinted pill with its own text — badges), `toneDot` (the 6px state dots),
`toneStrip` (a bordered notice that owns a row).

Rules:

- **Two states may share a tone.** `busy` and `success` resolve to the same emerald on purpose. A
  tone says what a mark *means*, not which state it belongs to. Where two states share a tone,
  separate them by **shape and motion** — that is what the session list's turning hourglass and
  squeezing compress mark do, and it is legible to a reader who cannot separate hues.
- **Never make colour the only carrier.** Every status mark also names its state in an accessible
  name or in adjacent text.
- **Contrast is measured, not assumed.** The ratios in `tone.ts` are WCAG 2.x against the four
  surfaces marks actually sit on — white and gray-50 in light, and the values this app *overrides*
  in `styles.css` for dark (gray-950 is `#000000`, gray-900 is `#0d0d0d`, not Tailwind's stock
  values). Recompute if you change a tone; a graphical mark needs 3:1, and `muted` is the one tone
  allowed below it because its meaning is always already in text.
- **What is out of scope**, and must not be folded in: categorical palettes where colour is an
  identity rather than a judgement (`category-colors.ts`, `token-colors.ts`, the timeline phase
  bars, per-skill avatar tints); the terminal's chrome, which resolves light/dark in JS because a
  subtree cannot opt out of the `dark:` variant (`terminal-appearance.ts` carries its own
  `success`/`attention`/`danger`); secondary body text, which is typography; a background-only wash
  on a card section; and hover-only variants, since a tone token is the resting ink.

## Explanatory text: semantics disclose, formatting stays

Two kinds of prose, and the split decides where each goes.

- **Semantics** — what a section is, what a field means, what it affects, when a change takes
  effect. Read once, then in the way forever. Put it behind `InfoPopover`
  (`components/ui/info-popover.tsx`): a circled "?" anchored on the section title, or on the field
  label via `Field`/`Input`/`Textarea`/`PasswordInput`'s `info` prop.
- **Formatting** — the shape the value must take: "one `KEY=value` per line", "one argument per
  line", "leave empty for unlimited", allowed characters, a `k`/`m` suffix. Read *while typing*.
  It stays on screen, in the field's `hint`. Hiding it turns a glance into a click and raises the
  error rate.

A string that mixes both is a string that should be split, not a judgement call. When you cannot
split it, keep it visible — a visible sentence is never a bug, a hidden format rule is.

Already-disclosed text does not move: `title=` tooltips, `OptionMenu` row descriptions, confirm
dialog bodies (the dialog *is* the disclosure), toasts, and empty states.

**The HTML trap this forces.** A `<button>` is a labelable element, and a wrapping `<label>` names
its first labelable descendant — so a "?" nested inside `Field`'s usual `<label>` would silently
retarget the field's title from the input to the button. `Field` therefore has two layouts: without
`info` it wraps in `<label>`; with `info` it splits the title out and associates it by `htmlFor`,
which is why the control needs an id. `test/info-popover.test.ts` guards this.

## Icons

One renderer: `components/ui/glyph-icon.tsx`. A 24×24 path, `strokeWidth` 1.7, `stroke="currentColor"`,
`fill="none"` (or `filled` for an "on" state). Do not hand-write an `<svg>` for a line icon — put the
path in the module that owns it (`lib/stat-icons.ts`, `components/ui/icons.tsx`, `group-list.tsx`,
`session-row-menu.tsx`) and render it through `GlyphIcon`.

Two marks deliberately live off that grid, because a two-stroke mark aliases when its grid and its
render size disagree: `ChevronDown` (12×12, stroke 1.5) and `CloseIcon` (14×14, stroke 1.5). Charts,
sparklines, the topology view, the ring gauges and the login background draw their own geometry and
are outside the family entirely.

Sizes come from `src/lib/icon-scale.ts`, named by role, not by number — `inlineGlyph` 13,
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

## Every user-facing string is bilingual

Two dictionaries: `src/lib/strings.ts` is zh (and defines the `Strings` type), `src/lib/strings-en.ts`
is en and is typed `const en: Strings`. Adding a key to one and not the other is a **type error**,
not a runtime surprise — and `test/placeholders-parity.test.ts` checks that both sides interpolate
the same placeholders. Add both, in the same shape, in the same PR.

`S` is a live binding swapped on locale change, so read it at render time; never hoist `S.x.y` into
a module-level constant.

Chinese belongs only in the zh dictionary, `titleZh` fields, `*.zh.md` documents, and fixtures that
exercise CJK behaviour. Comments, test names and every other string are English.

## Popups: portal, do not absolutely position

Anything that overlays — a menu, a picker, an info popover — uses `usePortalPanel`
(`components/ui/use-portal-panel.ts`) and `createPortal` to `document.body`, positioned `fixed`
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

Modals and `Dropdown` additionally register in the Esc-layer stack (`modal.tsx`'s `pushEscLayer`),
so Escape only acts on the topmost layer. A portal panel does not need to — capture plus
`stopPropagation` already gets there first.

## The rest of the house style

- **Stacking contexts**: chrome creates none; dropdown/user menus `z-40`; modal and drawer overlays
  `z-50`; portaled panels `z-[60]`. `styles.css`'s header states this.
- **Every scroll container is a containing block** (`styles.css`, `@layer base`). Do not undo it: an
  absolutely positioned descendant of a `static` scroller escapes to the initial containing block
  and gives the whole shell a second scrollbar. That bug shipped three times.
- **Animations are `transform`-only where possible**, so the global `prefers-reduced-motion` rule
  disables them into a correct resting state instead of hiding the element.
- **Comments explain constraints, not history**, and never cite a design doc — inline the constraint.

## Verify

```sh
pnpm --filter @prismshadow/penguin-web typecheck
pnpm --filter @prismshadow/penguin-web test
pnpm format && pnpm format:check
```

Playwright (`packages/web/e2e/`) only when selectors or flows move. On a shared machine, probe with
`ss -tln` before picking ports, and never point `PENGUIN_HOME` at `~/.penguin`.
