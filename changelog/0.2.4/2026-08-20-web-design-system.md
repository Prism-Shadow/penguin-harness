# Web App: one status-colour vocabulary, on-demand explanations, one icon family

- **Date:** 2026-08-20
- **Type:** refactor
- **Scope:** `web`, `tooling`
- **PR:** [#378](https://github.com/Prism-Shadow/penguin-harness/pull/378)

[中文版](2026-08-20-web-design-system.zh.md)

Three conventions the Web App had been carrying implicitly are now written down and enforced: a
status colour is picked by meaning from one module, an explanation is disclosed on demand unless a
user needs it while typing, and a line icon comes from one renderer at one weight in a role-named
size.

## Status tones

- `src/lib/tone.ts` holds five tones — `busy`, `attention`, `success`, `danger`, `muted` — in four
  maps by the shape of the mark: ink for a glyph or a line of status text, surface for a tinted
  badge, dot for the 6px state dots, strip for a bordered notice. Each light/dark class pair is
  written once.
- Migrated onto them: the run-state icon, the session activity glyph, the badge palette, the
  stream's step and goal banners, the reasoning-group header, the subagent and panel pending dots,
  the context-usage rings, the MCP connect status, the model speed badges, the update dialog, the
  initial-password banner, the placeholder-missing alerts, and the usage errors panel. Amber had
  been spelled three ways (`amber-600`/`amber-500`/`yellow-*`) for one meaning and emerald two;
  the run-state spinner and the failure glyph also moved up a step to clear 3:1 against white.
- The **session list's running hourglass is now the shared amber** rather than gray. Compaction
  keeps that same tone and takes a **new mark** — a bar with a chevron closing on it from each
  side, squeezing on a loop — so the two live states are separated by shape and motion instead of
  by colour alone.
- The contrast ratios recorded in the module are measured against the surfaces the marks actually
  sit on, including the neutral scale this app overrides in `styles.css` for dark mode: gray-950 is
  `#000000` and gray-900 is `#0d0d0d`, not Tailwind's stock values the previous numbers assumed.
- The terminal's chrome gained its own `success` / `attention` / `danger`, resolved in JS like the
  rest of its palette; its status dot had been painting the dark half of each pair on a light
  terminal.
- Categorical palettes stay out: chart series, token buckets, timeline phases and per-skill avatar
  tints are identities, not judgements, and must stay free to add a hue without it reading as a
  new severity.

## Explanations disclosed on request

Two forms, and a title decides which a surface gets: the circled "?" only ever appears beside a
title, and where there is no title the explanation names itself in a fold instead.

- New `components/ui/info-popover.tsx`: a circled "?" whose panel is portaled and positioned by the
  shared `usePortalPanel`, so it is not clipped by an ancestor's overflow and closes on outside
  click, Esc, scroll or resize. The trigger is a real button with an accessible name and points at
  the panel it opens; while open the panel is also the trigger's description.
- New `components/ui/help-fold.tsx`: a compact self-naming row that expands its explanation inline
  underneath, rotating the app's one collapse chevron. Inline flow, so no portal — it follows the
  WAI-ARIA disclosure pattern, keeping the panel in the DOM and `hidden` while collapsed so its
  `aria-controls` always resolves.
- Section descriptions with a title of their own took the "?": the skill library page, the models
  page's read-only notice, the MCP servers section, the Agent State transfer section, the tools
  table's `call_description` column, the four placeholder prompt sections, and the Project dialog's
  new-chat defaults block.
- The four Agent settings tabs — Vault, Memory, Schedules, Skills — took the fold. Their name lives
  in the tab bar and the panel does not repeat it, so there is nothing for a "?" to anchor to.
- Field hints that explain *semantics* moved to a "?" beside their label — the per-request timeout,
  the two compaction thresholds, the model-group protocol note, the new-chat default model's
  provenance, and where the built-in admin's initial password is printed.
- Hints that describe the *shape* of the value stay on screen: "one `KEY=value` per line", "one
  argument per line", "leave empty for unlimited", allowed-character rules, the `k`/`m` budget
  suffix. They are read while typing.
- `Field`, `Input`, `Textarea` and `PasswordInput` take an `info` prop for this. With it, the field
  associates its title by `htmlFor` instead of wrapping the control in a `<label>`: a button is a
  labelable element, so a nested trigger would take the title away from the input.
- `test/disclosure-anchor.test.ts` enforces the anchoring rule by parsing the JSX with the
  TypeScript parser: it fails, naming file and line, on any `InfoPopover` with no title among its
  preceding siblings — a comment or a neighbouring `<Button>` does not count as one.

## One icon family

- `GlyphIcon` is the single line-icon renderer (24×24, stroke 1.7, `currentColor`) and gained a
  `filled` variant. `group-list.tsx`'s `Icon` — a byte-identical second copy — now wraps it, and 25
  inline `<svg>` elements were replaced by shared components or paths.
- Duplicated glyphs collapsed to one home each: the form-control caret, the close cross, the
  collapse chevron, the folder outline, the external-link mark, the chat page's private copy of
  three stat paths, and `panels-toolbar`'s re-declared renderer.
- Stroke weights 1.6 and 1.8 are gone; the family is 1.7, with 1.5 reserved for the two marks drawn
  on their own smaller grids and 2 / 2.2 for the checkmark, the ring gauges and the collapse
  chevron.
- `src/lib/icon-scale.ts` names every size by role rather than by number and does the same for the
  icon-to-text gap. Applied where equivalent elements disagreed: the collapsible headers' status
  icon, the group-header action buttons and leading glyphs, the agent-card stat row, the skill card's
  button group, the composer's trigger pills and menu rows, and the traces page's export button.
- New tests cover all three: tone coverage and the no-inline-palette rule, the popover's ARIA and
  the field layout it forces, and the icon family's stroke set and one-copy-per-glyph rule.

## A frontend development skill

`.agents/skills/penguin-harness-frontend/SKILL.md` records these rules plus the two-dictionary i18n
contract and the portal-panel pattern with its Esc-capture and scroll-capture caveats.
