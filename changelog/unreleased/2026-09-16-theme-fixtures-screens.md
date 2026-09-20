# The shared UI package gains a mock dataset and four full-screen mock-ups for the gallery

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `ui`
- **PR:** [#763](https://github.com/Prism-Shadow/penguin-harness/pull/763)

[中文版](2026-09-16-theme-fixtures-screens.zh.md)

`@prismshadow/penguin-ui` gained `fixtures/`, one typed mock dataset in English and Chinese, and
`screens/`, four static full-screen compositions the theme gallery renders at `/screens/:name`. The
Web App imports neither, so it looks exactly as before.

## Fixtures

- The "Build Claude Code docs expert" session the landing page's screenshots are captured from, as
  a two-turn run: user and assistant turns, settled and streaming thinking and text, and tool calls
  to `exec_command` with output, `read_file`, `edit_file` and `write_file` with diffs, a
  `run_subagent` call with the child's own transcript, and a command waiting for approval.
- A Trace of the same run (file list, overall figures, per-turn timeline lanes and event rows), ten
  models copied from the built-in catalog, the Workspace file tree and a file preview, the sidebar's
  session groups, and a company with employees, tickets in every column and a week of calendar
  events.
- Chrome copy taken from the Web App's two dictionaries, and specimen text for the fonts page and
  the Typography foundation that mixes Chinese, Latin, code and numbers. The dock's and the
  sidebar's labels are the App's own ("Agents panel", "Bottom panel", "Right sidebar", "Hide
  sidebar", "List options", "New workspace"), and the accent list is the App's six options —
  `neutral` at `#6b7280` first, then the five presets `theme.css` declares — under the names the
  App gives them.
- The catalog rows are the built-in catalog's, `DeepSeek V4 Pro 0813` and `DeepSeek V4.1 Flash`
  among them; the test that pins them also fails a row the catalog has retired.
- The sets the gallery's modules compose: a notice per tone and a toast pair, a provider form with
  one invalid and one policy-held field, a message context menu with a shortcut and one destructive
  item, six Vault rows, four installed plugins, the command palette's two groups, and a week of
  token usage in three buckets. Their colours, versions, icons, shortcuts and series are
  locale-independent and live in `fixtures/shared.ts`; only words are per locale.
- `en` and `zh` are built from one structure (`fixtures/dataset.ts`) and differ only in prose;
  `fixturesFor(lang)` returns either.

## Screens

- `chat`: a Task mid-run, with the sidebar, an opened diff, a running subagent, a pending approval,
  the composer with chips, and the Subagents dock streaming the child's reply.
- `traces`: the Trajectories dock with the Overall summary, a turn's execution timeline, legend and
  event rows.
- `settings`: the paged settings dialog on Appearance over the chat, with an info popover open.
- `login`: the sign-in card over the decorative canvas, with the App's three-option language
  switch beside its three-option theme switch.
- The numbers are the product's: the stats line leads with the reply's time and carries input,
  output, TPS, cost and elapsed — no tool count and no cache share, both of which belong to the
  Trace page's turn card — the Trace's Overall prints Avg tools / turn, the composer's ring fills
  against the compaction threshold rather than the model window, and a file size reads `47.1KB`,
  the way `lib/format.ts` writes it.
- The screens use token utilities and the declared style hooks only, so each theme restyles them
  through its token values; package components replace their stand-in pieces wave by wave.
- The package exports them as `@prismshadow/penguin-ui/screens` (`SCREENS`, `screenById`).

## De-slop

The screens are held to the theme work's component rules, so what the gallery shows is what the
rules ask for rather than the drafts they were written from.

- The deleted style hooks are gone from the markup: no ambient wash or column grid behind a
  transcript, a settings page or a Trace panel, no dot matrix behind the login (the circuit traces
  stay — the login's one decoration, in every theme), no corner ticks on the approval block, no
  hover-pill radius on buttons and cards, no mono uppercase button labels. Controls read their
  shape from `--ui-radius-control` instead.
- Each remaining hook sits on the component that hosts it: the glass of the settings dialog is a
  `Modal`, the glass of its popover a `FloatingPanel`, the glass of the composer a `ComposerCard`,
  the rail's group titles the `PagedDialog`'s eyebrows, the sidebar's and the call graph's a
  `GroupHeader`, the diff a `DiffViewer` and the fenced block a `CodeBlock`. The dialog's page
  title is an ordinary `h2` — the display face is for a page's one display title — and it lost the
  sun glyph the rail already shows.
- Status is a word again: a run state prints in sentence case at the caption rung in its tone's
  ink (`Running`, `Needs approval`, `Failed`), with the five words in both dictionaries, instead of
  10–11 px uppercase with wide tracking. Nothing on the screens is set below `.75rem` any more.
- The pending-approval block keeps its amber fill but takes the neutral rule above it, and its
  alias is mono text rather than a chip; the subagent shortcut is a row under its call instead of a
  bordered card inside the work group; the Trace's Overall is a ruled section and its timeline sits
  in the turn's body, both without a box of their own; the composer's stop is a solid control, not
  a danger glyph on a danger tint.
- `Pill`, `IconSquare` and the hand-rolled ring spinner were replaced by stand-ins in the shapes
  W1's components take, so the swap is a rename: `Badge` (`tone`, `variant`, `soft` taking the
  neutral line), `IconButton` (flat at rest, filled only when `pressed`, label required) and
  `Spinner` (`xs` / `sm` / `md` at 10 / 12 / 14, `tone`, `label`). The spinner is the real
  component: it lives at `src/components/icons/spinner/spinner.tsx`, the one file allowed to spin,
  and draws an arc a theme re-times through `.ui-live[data-live="spinner"]`.
- The accent swatches' hex values moved into the fixtures, where identity data belongs, and each
  swatch now carries its name in both dictionaries.
- `Dot` takes a tone (plus `accent`, which the unread mark needs) and paints the tone's ink, and
  `Badge` takes the `sm` / `md` size K-redesign §5.1 names, so those two swap by rename as well.
