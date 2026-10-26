---
name: penguin-harness-frontend
description: >-
  Use when changing PenguinHarness frontend code: the Web App (packages/web), landing
  page (packages/landing), docs (packages/docs), component gallery (packages/ui-gallery),
  or shared UI package (packages/ui). Always inspect, reuse and extend shared UI first.
  Covers control behavior and cursors, theme tokens, icons, settings commits,
  bilingual copy, popups, layout, motion, gradients, navigation and responsive forms.
---

# Frontend conventions

`packages/web` is React 19 + Vite + Tailwind CSS 4, with no `cn`/`clsx`, no `tailwind-merge`, and no
variants library. Classes are composed with template literals, and a component's variants are a
`Record<Key, string>` next to it (`button.tsx`'s `variantClass`, `input.tsx`'s `sizeClass`). Match
that shape; do not introduce a styling dependency.

This file records the decisions that already exist so they are not re-litigated per PR. Read
`penguin-harness-dev` for the repo-wide contract (verification chain, changelog, two-repo layout).

## Start in the shared UI package

Before adding or changing a control on any frontend, inspect `packages/ui/src/index.ts`,
`packages/ui/src/site.ts` and the relevant component under `packages/ui/src/components/`. Reuse its component, hook or class helper. When it
lacks the behavior needed by the app, extend that shared component and update its callers. A
reusable interaction or visual rule belongs in `packages/ui`; each host supplies domain data,
routing, translated labels, preference persistence and actions. Do not copy a shared control into a feature or patch its defaults in
`packages/web/src/styles.css`.

Extract a common component or hook when the same interaction appears in multiple places. Keep the
abstraction at the concrete behavior being shared; a one-off business rule stays with its feature.
During review, check for duplicated markup, page-local overrides and call sites that bypass the
shared component. Verify the shared change in the gallery and in a representative host surface.

### Landing, docs and gallery chrome

Use `@prismshadow/penguin-ui/site` for the shared `SiteHeader`, `SiteNavLinks`,
`SiteLanguageMenu`, `SiteThemeToggle`, `SiteGitHubLink` and site icons, and for what the sites'
pages share: `SiteFooter`, `SiteCodeCard`, `SiteCopyButton`, `SitePill`, `SiteMarkdown` (article
prose with `SiteCodeBlock` and `SiteCodeTabs`; the docs pass `SITE_DOC_REMARK_PLUGINS` and every
site passes `highlightSiteCode`), `SiteToc` with `useActiveTocEntry`, `SiteSidebarNav`,
`SiteSearchDialog`, `SiteExternalLink`, the preference providers (`SiteThemeProvider`,
`SiteLocaleProvider`, the shared `penguin-site.*` keys) and `useRouteScroll`. Import
`@prismshadow/penguin-ui/site.css` for their scoped appearance and shared cursors; a site's
Tailwind entry also imports `site-page.css` (the `dark` variant, the brand scale, the neutral dark
ramp, body defaults). This entry is independent of the app renderer and full theme; public sites
do not need the app's bundled fonts just to render a page, nor the theme icon sets: a site control
draws line icons (`site-icons`, `CheckLineIcon`) and builds menu rows with `MenuRow`, never
`GlyphIcon`, `MenuItem` or a mark drawn in every set, any of which carries the sets into the
landing and docs bundles. Their wrappers only adapt routes, labels, content and preferences. Do
not restore copied navbar markup, language-menu event handlers, theme cycles, footers, copy
buttons or Markdown typography in a site package.

A site component is held to the package's de-slop rules like any other: its look lives in
`site-content.css` or `site-prose.css` on the `--site-*` palette (Tailwind's values, the neutral
dark ramp), never as palette utilities, `dark:` variants or literal font sizes in its markup.

Public-site controls keep their fixed visual identity through the gallery's theme changes.
Their shared recipes live in `packages/ui/src/site.css`; landing content, marketing sections and
docs prose retain their own layout. Reuse app primitives underneath (the language picker uses
`Dropdown` and `MenuRadioItem`, mobile disclosure uses `Fold`). Native title hints remain allowed
on this public-site chrome, which does not mount the app's `TooltipLayer`. The app conventions
below still apply to app-themed controls and previews.

### Cursors belong to the control

`packages/ui/src/cursors.css`, imported by both `theme.css` and `site.css`, owns the arrow cursor for buttons, tabs, menus, option and tree rows,
labels and form selectors. `NavRow` and `RailItem` also keep the arrow when rendered through a
router link. Public-site navigation uses the same arrow policy. Use hover ink or fill to signal these controls; do not add `cursor-pointer` merely
because something is clickable. Content links and `Button variant="link"` keep the hand. Text
entry, drag, resize, zoom and disabled controls keep their operation-specific cursors. Custom
interactive cards and table rows use their shared UI component's cursor behavior.

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
- **No coloured dot carries a status on its own** (owner, 2026-10-15: 「不要用意义不明的颜色点」,
  after the Machines page's blue dot). A dot whose meaning lives only in its hue and a hover is a
  mark the reader has to decode. A state is a **labelled pill** — `Pill` in the state's tone, its
  word on screen and no glyph, the reason on the pill's `tooltip` (`MachineStatusPill` is the
  pattern) — or, where a row has no room for a word, an **icon** whose shape says the state and
  whose tooltip and `aria-label` name it. A dot stays only as decoration beside words that already
  say the state, or as a pulse on something live.
- **One shape for every short label on a row** (owner, 2026-10-15: 「运行中胶囊和本服务端统一一下，用
  ui 库抽象」). A state, a kind or a fact beside a name ("Running", "this server", "v0.2.16",
  "vision", "CLI") is a `Pill`: the badge at its small size in its soft weight, words only, with
  only the tone to choose. Two labels side by side never differ in height, padding, radius, type
  or border. Reach for `Badge` itself only for what is not a row label: a count, an outline or
  solid weight a design asks for, a superscript mark.
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

### Placeholders: what blank does, or what to do

A placeholder says what happens if the field is left as it is, or the next step to take (owner,
2026-10-24): 「留空则使用环境变量 DEEPSEEK_API_KEY」 says what blank does, 「请填写 API key」 what
to do, 「留空使用默认 base URL」 both. A field whose blank state means something, or that must be
filled, never has an empty placeholder. No bare status word (「未设置」) and no value dump
(「默认发往 <url>」): the placeholder speaks to the reader's next move, not to the configuration.
A required field with a stored value shows the value itself; the placeholder covers the empty
state only.

### Tooltips: when a mark gets one

A hover hint shows where its words are not on screen (`hintAllowedFor` in the UI package's
tooltip.tsx): an icon-only control, a wordless mark, an input, or text that is cut off. Text that
is not read as words does not count — an SVG's own text (an avatar's initial) and anything
`aria-hidden` — so a letter or a count drawn as an icon (the find bar's `Aa`, a corner count) sits
in an `aria-hidden` span while the control keeps its name in `aria-label` or `sr-only` text. Three
glyphs are read without one — the circled "?" beside a title (`InfoPopover`, whose hover opens
the explanation itself), a close or clear ×
beside the thing it dismisses, and a fold chevron under the rows it folds — so they carry no
`data-tooltip` unless the hint says something the glyph cannot: a shortcut ("Close (Esc)"), a
consequence ("Kill this terminal"), the subject when it is not beside it. That is why `DockTabs`'
close × keeps its hint (the shortcut; on a terminal tab, the consequence) while the password
banner's × and a browser tab's × have none. Either way the mark keeps its `aria-label`; that name
is for assistive technology, not a panel. A hint on text that may truncate shows that text whole
(plus an id when one helps), never the verb of the click — the underline already says it opens.

**No ellipsis hides text for good** (owner, 2026-10-12: "缩略的路径或者文字…至少 hover 可以显示"). A
line shortened by `truncate` or a line clamp needs no attribute: when it is actually cut off and
nothing around it carries a `data-tooltip`, `TooltipLayer` shows its whole text on hover or
focus (the code panel for a monospace line), and a pointer resting on a row control picks the
row's first cut-off line. Write a `data-tooltip` only when the hint should say more than the line
itself. A subtree that decides its own hint opts out with `data-tooltip-owned` — `<Tooltip>`'s
wrapper does, and so does a title while it scrolls its tail into view (`Truncated`). A value the
code shortens before it reaches the DOM (a basename, `…/parent/file`, a short id) is not covered
by this — its whole form is not on the page — so it carries the full value as a marked hint.

**A hint that says what the screen does not is marked, and then shows over visible text** (owner,
2026-10-12): `data-tooltip-extra`, `<Tooltip extra>`, or the `tooltipExtra` / `titleExtra` prop of
a component that takes its hint as a prop (`NavRow`, `Chip`, `FormPickerTrigger`; a `Badge`'s
`tooltip` is always one). Mark only what is not on screen: what a click does or discards ("the
captured output is discarded too"), why a control is disabled, a keyboard shortcut ("New chat
(⌘N)"), the full value behind an abbreviation where nothing else on that screen shows it (a path
behind its last segment, a full id behind a short one, an exact time behind "3 min ago", a model
id behind its name), and what a state means ("Failed" and why, "Blocked" and on what). Mark a
conditional hint conditionally (`data-tooltip-extra={!folder}`; `"false"` reads as unmarked). A
hint that repeats the visible words, or only names the glyph a figure sits beside (`StatChip`),
is never marked and never shows; a data row's detail goes unmarked when it is one click away (the
dialog its title opens).

A total's breakdown is never a marked hint: the token total's and the cost's three usage parts and
the elapsed time's API / tool components go behind a circled "?" right of the total (`StatHint` in
`components/ui/stat-hint.tsx`, whose rows the Trace overview and the chat details card share), and
only totals carry one: a per-round reading shows its total alone, and a reading that is itself a
button (the chat header's chips) gets no "?" — its breakdown lives in what it opens. A rate is a
reading, not a part: the cache hit rate stays inline beside the token total. Nor does a marked hint
earn a "?" of its own: the "?" stays with titles and totals.

### Which disclosure — the "?" or the fold

Two forms, and **a title decides between them, not taste**:

> **The circled "?" may only appear beside a title, or right of the total it breaks down. It
> must never stand alone on its own line. Where it would stand alone, use the fold.**

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

**A toolbar is one height.** `Button`'s `sm` and `base` rungs are the controls' own heights, so a
search box, a `Select` and a button of one rung line up. A choice in a toolbar is the package's
`Select` at that rung (the machine picker is one), never a button dressed as a select with a fixed
`h-*`: the old machine picker, a button with `h-8`, stood about 5px above the controls beside it.

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

## Settings controls: a switch commits, a form saves, leaving asks

Owner rule (2026-10-10), the same on every settings surface — the Settings dialog, the Agent
settings tabs, project settings, the model and provider dialogs, plugin cards, messaging, company
mode, machines, workflows:

- **Instant controls commit on the gesture.** `Switch`/`ToggleRow`, a standalone `Checkbox`,
  swatches, pin/star marks, the shortcut recorder — and a `Segmented`, `RadioGroup`,
  `Select`/`OptionMenu` that is the only control in its `PrefRow`. Render the new value at once,
  write only that value, settle on the server's answer; on failure roll back **and**
  `toastError(apiErrorText(e))` (or the row's hint slot) — `useInstantSetting`
  (`lib/instant-setting.ts`) does all three. A consequential switch asks first through
  `ConfirmModal` and shows the stored state until confirmed — and joins
  `test/consequential-confirms.test.ts`. A switch that acts on a typed value acts on the *saved*
  value: while that value has unsaved edits (or is missing, where the switch means nothing
  without it), disable it with a hint that says what to save (`S.settings.saveProxyAddressFirst`,
  `S.messaging.saveBeforeEnable`). Instant controls are never part of a draft and never dirty.
- **Typed controls commit on Save.** `Input`, `Textarea`, `PasswordInput`, numbers, URLs,
  key-value and lines editors, `TagInput`, table/list editors, prompt editors. Never on blur, never
  debounced, and never on Enter in a form of more than one field — Enter may submit a form whose
  only field it is (an API key's name, a rename), and that is still the Save. Build the form on `useFormDraft(loaded, { scope })` from `@prismshadow/penguin-ui`:
  bind `draft`/`patch`, compute inline `errors` from the draft, and render
  `<Button size="sm" variant="primary" disabled={!dirty || errors !== null || busy}>{S.common.save}</Button>`
  plus Cancel (a dialog) or Reset (`S.common.reset` on a page; `disabled={!dirty}`, no confirm).
  After a successful save call `adopt(response)`; after a failed one do nothing — the draft stays
  dirty and the error sits under its field. Save writes at once: no "save changes?" confirm before
  an ordinary Save; a `ConfirmModal` precedes a save only when it overwrites or destroys something
  else (a file on disk, an imported snapshot, restoring defaults, a delete, a price change that
  clears a promotion). A select, segmented control or radio inside such a form is a field of the
  form. A create-or-edit dialog of one record (an MCP server, a key, a schedule, a model, a
  provider group, a messaging binding, a machine, a user, an Agent) is one form, its switches
  included; so is a table whose rows are added in the draft (command-policy rules, plugin tables).
- **Leaving a dirty form asks, once, through one card.** `useFormDraft` registers the form while
  it is dirty; the app's `NavigationGuard` (a `useBlocker` on the data router) catches every route
  change, `?tab=` switches, sidebar links and browser back/forward included; a dialog passes
  `useGuardedClose(onClose, form.scope, { locked: busy })` as its `onClose` **and** to its Cancel
  button, which covers Esc, the ×, the scrim and Cancel — and while its save is in flight
  (`locked`) none of them does anything, since a close then would "discard" what the request is
  about to store. A dialog whose pages save on their own (the Settings and Project settings
  dialogs) cannot see those saves: each page registers its Save in flight with
  `useSaving(busy, scope)` on the dialog's scope (a switch's write holds nothing), and that holds
  the close and the dialog's rail or tab switch alike. Any other state switch that would replace a
  form (a rail, a local tab strip, a machine picker, a document switch) goes through
  `guardLeave(action, scope)`, which does nothing while a save is registered in `scope`; a route
  change and a page unload are never held. The card is `UnsavedChangesHost` in `App`:
  「放弃未保存的修改？」, danger 「放弃修改」, 「继续编辑」. Never render a second discard dialog,
  never offer "save and leave", never ask when the form is clean, and never make a switch count
  as dirty. Mount a dialog's form only while the dialog is open — a closed dialog that keeps a
  dirty draft keeps the router asking about a form nobody can see. `beforeunload` is the host's
  job (the browser's own words); the desktop shell answers `will-prevent-unload` with a native
  box.

Checklist for a new settings surface:

1. Sort every control: instant or typed. A switch beside typed fields is still instant (write
   it alone, adopt the response; the typed draft stays) unless the dialog creates or edits one
   record.
2. Typed → `useFormDraft` with the surface's `scope` (one shared scope per dialog or rail, none
   for a record dialog, which gets its own); Save gated on dirty **and** valid; Reset or Cancel;
   errors inline; `adopt` on success only.
3. Dialog → `useGuardedClose` on `onClose` and Cancel, `locked` while its save is in flight; a
   page inside a dialog it shares a scope with → `useSaving(busy, scope)` around its Save, which
   holds the dialog's close and its rail or tab switch.
   Page tabs in `?tab=` need nothing more. Non-router switches → `guardLeave`. A dialog whose
   success hands off to a navigation (open the new record, switch Project, re-read the session)
   calls `discardUnsaved(form.scope)` once the write lands: its form is still mounted and dirty
   when the caller navigates, and the router would hold that navigation behind the prompt.
4. Add the module to `FORM_MODULES` in `test/form-commit-guard.test.ts`; it fails on an `onBlur`
   save, a Save form that does not register, a `Modal` in a form module whose `onClose` is not
   the guarded one, and a Save form in the Settings or Project settings scope without `useSaving`.
5. Scenarios (a `@vitest-environment jsdom` suite on `test/helpers/dom.ts`): asks on each leave
   path when dirty, not when clean; Save held while clean or invalid; a failed save stays dirty;
   the switch beside the form writes alone and rolls back with a toast.
6. Strings in both dictionaries; buttons `size="sm"` in dialog bodies and footers.

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

**A row's text gives way; its actions never do.** Items with actions are `ListRow` rows: text
`min-w-0` + `truncate` (whole on hover, no attribute), actions keep their width and wrap under the
text, never clipped. A box that sizes to its content (a grid's `auto` column, a fold body) holds
its child with `min-w-0`, or one long line widens every row past the card (ui-gallery `test:e2e`).

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

## Gradients: only where they have a job

A gradient carries the data's shape, a state transition, or — deliberately, and once — the one
emphasis a surface carries; it is never atmosphere, a glow or a wash behind content (owner,
2026-10-11: "UI 里面使用渐变一定要保持克制"). A surface that must stand apart does it with a flat
token fill and its rule — Frost's navigation column is frosted glass over one flat field, with no
wash. The five that stay, each with its job:

- the running step's label sweep (`ui-activity`, Frost): the one signal that a step is in progress;
- the streaming reply's veil (`ui-stream`, Frost): the newest lines are the faintest;
- a chart area's fade towards its baseline (`ui-chart`, a mask): the data's shape;
- the context bar's hatch past the compaction threshold (`.context-hatch`): room the model has that
  compaction fires before;
- the sweep across the brand name in the models page's TokenDance banner (`.banner-shimmer`): a
  deliberate emphasis on the sponsor's name, the one emphasis the banner carries (owner,
  2026-10-12: "这个是着重的"). An emphasis is allowed only like this: asked for, one word, one
  surface, nothing else moving beside it.

Rule 18 of the de-slop guard (`packages/ui/src/testing/deslop.ts`) fails a gradient in any other
hook recipe, as a background or a mask. A gradient in app CSS outside a hook is review: name its job
in the PR, or leave it out. Product logos keep their own artwork.

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
- **What a message carries is an attachment tile.** An image or a file attached to a message —
  staged in the composer, sent, or inside a steer — is the UI package's `AttachmentImage` /
  `AttachmentFile` in an `AttachmentList`, never a hand-built thumbnail or a chip. An image box
  takes a box radius (`rounded-md`), never `rounded-control`: Frost's controls are pills at
  9999px, and that radius on a box that is not square draws a stadium (owner, 2026-10-17:
  「图片传上去不知道为啥变成椭圆了」). The gallery's attachments board and its browser spec
  (`packages/ui-gallery/e2e/attachments.spec.mjs`) hold the shapes.
- **Comments explain constraints, not history**, and never cite a design doc — inline the constraint.

## Verify

```sh
pnpm --filter @prismshadow/penguin-web typecheck
pnpm --filter @prismshadow/penguin-web test
pnpm format && pnpm format:check
```

Playwright (`packages/web/e2e/`) only when selectors or flows move. On a shared machine, probe with
`ss -tln` before picking ports, and never point `PENGUIN_HOME` at `~/.penguin`.
