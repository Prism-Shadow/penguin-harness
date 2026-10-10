# No AI slop: the UI and the copy look chosen, not generated

AI slop is the look a generated product falls into when nobody decides anything: every default
switched on at once — a gradient, a glow, emoji, a pill on every row, a card around every card,
"it's not just X — it's Y". It reads as designed in a thumbnail and falls apart on a second look.
The Web App, the landing site, the docs and the Electron shell are all written by agents, which is
exactly why they drift there; this page is the brake.

It applies to **every** change that renders something or says something to a user: a component,
a class list, a string in `strings-en.ts` / `strings.ts`, a docs page, a blog post, a changelog
entry, a PR body.

## The six rules, held on every change

1. **Decide before you decorate.** Every visual choice must be explainable in one sentence. "It
   looked empty" is not a reason.
2. **One accent, one voice.** The theme's tokens carry colour; no new hues, no second accent, no
   gradient.
3. **Hierarchy from scale and space.** Not from colouring or bolding scattered words, not from
   swapping fonts.
4. **Subtract first.** The first move toward better is removing something — a border, a badge, a
   shadow, a sentence.
5. **Specific beats punchy.** Copy says the concrete thing: what happened, what to do, with what.
6. **Decoration must mean something.** An icon, badge, callout or colour is a signal; if it
   signals nothing, it goes.

## What this repo already decided (these win over any generic rule)

- Status is the icon's tone plus a tooltip / `aria-label` — no textual `[failed]` markers, no red
  warning prose. Icon-only buttons are flat: no fill at rest or on hover, the glyph deepens.
- Info and action sections are ruled (a divider, title left, actions right), not boxed in cards.
  Labels small and grey, values dark and semibold.
- List rows are one line: logo, name, the library's own pills right after the name, no raw ids
  (a tooltip at most). A pane is sized to its rows.
- Dense lists (settings shortcuts, pickers) use small type and no rule under every row; the group
  heading is the only divider.
- Colour comes from the theme tokens and the `tone*` helpers (`lib/tone.ts`), which already exist
  for attention / danger / success — reuse them, never hand-pick a Tailwind hue.
- zh copy follows the docs typography rules (CJK–Latin spacing, full-width punctuation, zh
  "Agent"); prose hygiene for anything published is in `authoring.md`.

## How to check a change

Read the diff once as a user would see it, against the six rules and the list above. Then run the
scanner over what you touched — it is dependency-free Node and never edits anything:

```sh
node .agents/skills/penguin-harness-dev/reference/ai-slop/scan.mjs packages/web/src
node .agents/skills/penguin-harness-dev/reference/ai-slop/scan.mjs packages/landing --only=14,15,29
node .agents/skills/penguin-harness-dev/reference/ai-slop/scan.mjs <dir> --json   # for triage
```

Every hit is a lead, not a verdict: open the file and decide **slop vs. chosen**. A deliberate
brand element, a logo, the theme's own tokens stay. Pin a hit you confirmed as intentional with
an id-scoped comment (`deslop-ignore-next-line 06`) so new tells still surface. A new hit in your
own diff is yours to remove before the PR, or to name in the PR body with the reason it stays.

Do not sweep the codebase on your own: when a scan turns up existing slop outside your change,
list it in the PR body or tell the user, and fix it only when asked — the diff stays about its
subject.

## The catalogue

Vendored verbatim from [yetone/kill-ai-slop](https://github.com/yetone/kill-ai-slop) (`skill/`,
commit `f6e2ae32b304`, Apache-2.0 — `ai-slop/LICENSE`). The three references still say
`references/` and `scripts/` for their own layout; here they all sit in `ai-slop/`.

| Read | For |
| --- | --- |
| `ai-slop/taxonomy.md` | The 35 tells — colour, type, copy, components, motion, layout — what each is, why it reads as machine-made, the fix |
| `ai-slop/detection.md` | The patterns the scanner greps for, and their common false positives |
| `ai-slop/fixes.md` | Before → after remediation per tell |
| `ai-slop/scan.mjs` | The scanner (`--only`, `--skip`, `--exclude`, `--json`) |

To refresh from upstream, copy the same four files over and update the commit above.
