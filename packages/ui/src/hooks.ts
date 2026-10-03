/**
 * The style hooks: the closed list of `ui-*` classes a component may carry so that a theme can
 * give it a treatment tokens cannot express (a backdrop blur, a ruled frame, a stepped animation,
 * a colour field behind the app window, connector rules between nested rows).
 *
 * A hook names a job, never a look. The component carries the class, and each theme file decides
 * in `@layer ui-theme` what the hook does, which may be nothing: Primer's `.ui-glass` and
 * `.ui-shell` are no-ops. The layer sits after Tailwind's `utilities`, so a recipe beats the
 * utilities its host also carries.
 *
 * Only the names below exist. A `ui-*` class outside this list is a decoration without a job, and
 * the package's de-slop guard fails it. Adding a hook is a design change: add it here, give it a
 * recipe (or a documented no-op) in every theme file, and list its allowed hosts.
 *
 * | hook               | the job                                                  | anatomy the recipes rely on                           |
 * | ------------------ | -------------------------------------------------------- | ----------------------------------------------------- |
 * | `ui-glass`         | a transient layer over content: menus, popovers, the     | a dialog is `[role="dialog"]`, its head, padded body and foot direct children `data-slot="head" \| "body" \| "foot"` (a caller-owned body carries no slot); a menu's rows are `[role="menu"] > [role^="menuitem"]`, a listbox panel's `[role="option"]` children; a tile carries `data-glass="tile"` and its hue as its ink |
 * |                    | modal card, the floating composer and launcher (and a    |                                                       |
 * |                    | fullscreen dock's exit button), a sticky page header —   |                                                       |
 * |                    | and a plugin or skill tile, the one glass                |                                                       |
 * |                    | that is not transient                                    |                                                       |
 * |                    | hosts: `ComposerCard` and its `SlashMenu`, `Modal`,      |                                                       |
 * |                    | `Dropdown`, the selects, popovers and tooltips,          |                                                       |
 * |                    | the launcher's ball and fan, `DockFrame`'s exit button,  |                                                       |
 * |                    | `SkillTile`                                              |                                                       |
 * | `ui-eyebrow`       | a group label naming the items below it (never directly  | —                                                     |
 * |                    | above an `h1`–`h4`); hosts: `Text variant="eyebrow"`,    |                                                       |
 * |                    | the sidebar's and group headers' labels                  |                                                       |
 * | `ui-display`       | the one display title of a page or hero                  | only on an `h1` or `[aria-level="1"]`                 |
 * |                    | hosts: `Heading level={1} display`, `PageHeader`'s title |                                                       |
 * | `ui-live`          | motion for something that is running right now           | `data-live="dot" \| "caret" \| "spinner" \| "bar"`   |
 * |                    | hosts: the Spinner, a pulsing Dot, the streaming caret   |                                                       |
 * | `ui-frame`         | a ruled box with a head, a body, a foot and panes        | children carry `data-slot="head" \| "body" \| "foot" \| "pane"` |
 * |                    | hosts: the transcript's cards and harness notes, the     |                                                       |
 * |                    | code block, `Card`, a framed `Table`                     |                                                       |
 * | `ui-underline-nav` | the selected-tab marker of a tab bar (a page's tabs, a   | items `[role="tab"]`, selected by `aria-selected="true"` |
 * |                    | dock's tab strip)                                        |                                                       |
 * | `ui-shell`         | the app window: a navigation column beside a main column | children carry `data-slot="nav" \| "main"` (a right column may carry `"dock"`); the selected nav row is `[aria-current="page"]` |
 * |                    | host: `AppShell`                                         |                                                       |
 * | `ui-icon-decor`    | an icon that says nothing its label does not already say | on the icon itself (or the element holding only it); optional `data-role="nav" \| "group" \| "menu" \| "empty"` |
 * |                    | hosts: the icon renderers' call sites, `NavRow`'s glyph  |                                                       |
 * | `ui-tree`          | a container whose rows nest                              | rows carry `data-depth="0"…"8"`, the last row of a level `data-last="true"`; a row's children may follow it in a `data-branch` element carrying the children's `data-depth` |
 * | `ui-field`         | a labelled control row                                   | children carry `data-slot="label" \| "control"` and optionally `"hint"` |
 * | `ui-activity`      | a row of the transcript's work: a step of the agent's    | `data-kind="thinking" \| "tool" \| "event"`, `data-state="running" \| "done" \| "error"`; descendants may carry `data-slot="label" \| "detail" \| "progress" \| "mark" \| "toggle" \| "toggle-end"` (the progress slot exists only while running, hidden by the host — a recipe that draws it sets `display` itself; `mark` wraps the leading status icon; `toggle` is the fold's chevron after the words, carried to the far edge by `order-last`; `toggle-end` is a chevron button at a row's end that a theme showing `toggle` hides); a row that opens holds its expanded body in a `data-slot="body"` element after the row (an `ActivityGroup`'s body is its frame's `body`), and what shows under a row whatever its fold (a call's approval) in a `data-slot="under"` element before the body |
 * |                    | (a thinking row, a tool-call row — `DisclosureRow` —     |                                                       |
 * |                    | and the head of the `ActivityGroup` holding them) or an  |                                                       |
 * |                    | event of the harness's (an `event` `ActivityGroup`,      |                                                       |
 * |                    | `TranscriptNote`)                                        |                                                       |
 * | `ui-notice`        | a notice: a toast, an inline notice strip                | `data-tone="info" \| "success" \| "warning" \| "danger" \| "neutral"`; children may carry `data-slot="icon" \| "title" \| "body" \| "actions"` |
 * | `ui-chart`         | a chart's root (its `<svg>`)                             | parts carry `data-part="grid" \| "axis" \| "series" \| "area" \| "bar" \| "point" \| "label"`; a series may carry `data-series="<n>"` |
 * | `ui-scrim`         | the dimmed layer behind a dialog, drawer or sheet        | —                                                     |
 * | `ui-stream`        | the body of an assistant reply, which may still be       | `data-state="streaming" \| "done"`; while streaming, the markdown blocks are followed by the stream's edge, a direct child `data-slot="caret"`, and then by anything the host appends |
 * |                    | streaming                                                |                                                       |
 * | `ui-glyph`         | an icon drawn in every theme's style; the theme's CSS    | direct children `data-set="line" \| "octicons" \| "pixel"`, one drawing each; the line set may hold a `data-part="duo"` body under its stroke; a decorative glyph may carry `data-tint="<hue>"` |
 * |                    | shows its own; hosts: `GlyphIcon`, `GlyphMark`           |                                                       |
 *
 * `ui-shell` is the one place a theme may paint a field of colour: Frost paints a soft pastel
 * field behind the window (a sky wash from the top corner, a lilac one from the bottom) and
 * sets the navigation column on it as milky, translucent glass with a lit inner edge, beside the
 * opaque near-white main column — the glass takes no backdrop filter, since the field is all
 * that lies behind it and the column must not become a stacking context; Console rules the
 * columns off each other with hairlines, full bleed; Primer changes nothing — the window's look
 * is its own classes.
 *
 * `ui-glass` is a floating layer's frost, and in Frost it also dresses the one glass that does
 * not float: a plugin or skill tile (`SkillTile`, `data-glass="tile"`), a translucent square in
 * the tile's own hue with a hairline edge, a lit top and a deeper foot. Primer and Console have
 * no glass recipe, so a tile keeps its host's tinted square there. Frost's dialog is opaque, its
 * head and foot draw no rule, the title sits a section title's distance above the body, and a
 * menu's rows are inset bands concentric with the panel.
 *
 * The three structure hooks (2026-09-19) are how the themes differ in organisation, not only in
 * colour and radius:
 *
 * - `ui-icon-decor` marks the icons a theme may recolour or drop: a nav row's glyph, a group
 *   header's, a menu row's, an empty state's illustration — never a status mark, a file kind, a
 *   tool glyph or an avatar, which carry information and stay in every theme. Primer keeps them
 *   monochrome; Frost paints each in its glyph's hue — `data-tint`, one of the nine
 *   `--ui-icon-tint-*` tokens, chosen per glyph by concept family (`ICON_TINTS`) so a concept
 *   wears one colour everywhere — for the `nav`, `group` and `empty` roles, the muted ink for a
 *   decorative path with no tint, and a menu row's icon keeps the row's own ink (a danger row
 *   keeps its red); Console hides them, so the eyebrow and the selected row's weight carry the
 *   structure and it shows far fewer icons.
 *   A call site applies it by passing `decor="<role>"` to an icon renderer (`GlyphIcon`,
 *   `Glyph`), which writes the class, `data-role` and, for a registry glyph, `data-tint` for
 *   it; the hook guard reads the prop on the call site and holds the enclosing row or header to
 *   the host list. A wrapper that holds only the icon may carry the class itself instead, so a
 *   hidden icon leaves no empty box behind in a flex row.
 * - `ui-tree` marks a list whose rows nest: a file tree, an activity group's rows under its head
 *   (a work group's steps, a compaction's sections, an MCP connection's servers), a plan's
 *   sub-steps, the subagent call graph. A host indents its rows itself, by
 *   `calc(var(--ui-tree-inset) + var(--ui-tree-indent) * depth)`, so every theme's connector
 *   rules land on the same columns; rows directly under the container's own head (an activity
 *   group's rows) are depth 1, a tree's roots depth 0, and depths past 8 draw
 *   as 8. Console draws `├─` / `└─` connector rules in CSS (no box, no glyphs in the markup) and
 *   takes the box away from a frame whose body is a tree; Frost indents against a soft guide
 *   rule and keeps its card; Primer keeps today's bordered box. A branch is a plain block
 *   holding one level's rows right after their parent row (`<li data-depth="1">` then
 *   `<div data-branch data-depth="2">`); the recipes continue the parent's rule alongside it.
 *   Rows draw with `::before` / `::after`, so a tree row carries no pseudo-elements of its own.
 * - `ui-field` marks a labelled control row — a form field or a settings row — so a theme can
 *   lay its parts out its own way: Primer keeps the host's layout (label above in a form, label
 *   left and control right in settings); Frost keeps the host's row and sets it as a band in a
 *   soft-filled group, the block's first and last rows rounded; Console sets a tabular row with
 *   a fixed label column (`--ui-field-label-w`) and the control left-aligned in the next, the
 *   hint under the control, so a settings page reads like a table. The hint (or error) may be its
 *   own slot or sit inside the label slot. A settings row (`PrefRow`) is a grid whose first line
 *   is one height in every row — the label slot offset to centre the title's line on it, the
 *   control slot at least that tall with its content centred — and whose hint is its own slot,
 *   in the row's second grid row; a recipe that moves the slots keeps that first line.
 *
 * `ui-activity` (2026-09-29) is how a theme renders work in progress without the component
 * knowing which theme runs. The host writes what it knows — the kind of step, its state, and
 * which descendant is the mark, the label, the detail (a path, an argument preview, a duration)
 * and the progress slot — and stays a plain row under Primer. The hosts are the activity
 * family's two components, `ActivityGroup` (the card: the agent's work group, and every harness
 * event that opens) and `DisclosureRow` (a row in it: a thinking step, a tool call, a
 * compaction's section, an MCP server), and `TranscriptNote`, the family's one-line note, built
 * from the same head pieces. A failed step's label takes the danger ink from its host in every
 * theme, so a failure never rests on its mark alone.
 *
 * Frost draws the family as words, the way Codex and macOS show work in progress: no status mark
 * (the mark slot is hidden in the running and done states, so a row reads as its label, its
 * details and the small chevron after them; an error keeps its cross beside the danger-ink
 * label), no fill on hover (a hover lifts the label and the details to the body ink, and a
 * keyboard focus ring is drawn inside the row) and no rules (the card's box, the rule under its
 * head, the dividers between rows and the top rule of a row's expanded body are transparent) —
 * nothing around the row, no ring and no halo. While a step runs a soft highlight in the
 * accent's hue sweeps across its label; at rest nothing is added. Console renders a transcript:
 * the label in the mono face at the small rung, uppercase and tracked, muted once done and full
 * ink while running, the detail muted, no box around the row and no fill that moves between
 * rest, hover, open and stuck (a hover changes the ink alone), and a hatched block bar in the
 * progress slot while the step runs; a step in a work group hangs off the `└` its `ui-tree` row
 * draws. Both recipes go still under reduced motion (a plain label, the bar holding one fill)
 * and read as finished at rest. Primer and Console keep the host's status icon (Console turns a
 * settled fold's into its ▸ / ▾ mark); only Frost drops it.
 *
 * The kind is `thinking`, `tool` or `event`. An event is something the harness did or injected
 * rather than a step the agent took — a compaction and its sections, an MCP connection and its
 * servers, a background task settling, an injected message, a trigger, attached files, a
 * handoff — written on the agent's own anatomy: an `ActivityGroup` of the `event` kind for a
 * card, `TranscriptNote` for one line. No recipe branches on the kind, so an event renders as a
 * step in the same state does (settled, or running while a compaction or a connection is in
 * flight), and a harness row reads as a work group in every theme: Primer's card or grey pill,
 * Frost's line of words, Console's transcript line with the fold mark leading. A hover answers
 * only a row that does something (one that is or holds a button); a note with nothing to open is
 * held still in every theme. A harness row's label is a fixed phrase and
 * never holds a name, since a recipe may recase the label (Console uppercases it): the task,
 * the organization, the skills, the files, the agent, the server or the objective it names sits
 * in a detail, which no recipe recases.
 *
 * `ui-notice` and `ui-chart` (2026-09-29) let notices and charts differ per theme where their
 * components had one look. A notice names its tone; Primer keeps the host's own strip, Frost
 * floats a soft card on the overlay surface with the tone as one small dot of its ink, Console
 * prints a console status line — a bracketed tone tag (`[INFO]`, `[ OK ]`, `[WARN]`, `[FAIL]`,
 * `[NOTE]`) in the tone's ink and the mono face, the message in the reading face, nothing
 * round it. A chart names its parts;
 * Primer keeps the host's drawing, Frost draws soft low-chroma series, translucent bars with no
 * outline, round joins, caps and points and a fading area, Console draws thin solid
 * bars outlined in the ink, a dashed grid on crisp pixels, axis labels as tracked mono capitals
 * and 1px stepped lines with square joins. Nearly all of that is tokens the chart primitives
 * read (`--ui-chart-*`); a recipe adds only what a token cannot say — dashes, joins and caps,
 * pixel alignment, a fade. A series keeps the colour its host gave it in every theme.
 *
 * `ui-scrim` (2026-09-30) is the backdrop a dialog, drawer or sheet dims the page with: the host
 * paints its dim from `--ui-overlay-backdrop` and carries the hook, whether the scrim is a
 * sibling behind the panel or the full-viewport overlay the panel sits in. All three themes leave
 * the dim as it is — the page behind a dialog is dimmed, never blurred: Frost keeps its frost for
 * the chrome (the navigation column, the plugin tiles) and the layers floating over content, and
 * its dialogs are opaque. The hook stays the door a theme would take to treat the backdrop. It
 * moves only with the host's fade, so reduced motion needs nothing from it.
 *
 * `ui-stream` (2026-09-30) is how a theme shows a reply arriving. The host is the reply's body
 * (`AssistantText`): it stays `data-state="streaming"` until its paced reveal
 * (`--ui-stream-reveal` / `--ui-stream-rate`, tokens.ts) has caught up with the stream, and until
 * then renders the stream's edge — the caret slot, `StreamingCaret`, itself a `ui-live` caret —
 * as a direct child right after the markdown blocks; whatever else it holds (a stop reason, a
 * files card) comes after the caret, and the host holds those back until `done`. Primer changes
 * nothing: the host's own pulsing caret glyph stays. Frost hides the caret and lets the trailing
 * lines surface through a soft veil — a gradient from nothing to the page's colour over the last
 * three lines, with a faint glow in the accent's wash behind them — drawn only while the caret is
 * the host's last child, so the veil covers the text and never what the host appends after it;
 * on `done` the veil eases away over the reveal duration instead of snapping off. Console draws
 * the caret as a solid block cursor in the body ink, a mono cell wide, blinking in steps, and
 * runs a last paragraph in so the cursor follows its last character; nothing else moves. Under
 * reduced motion the caret holds still and Frost draws no veil.
 *
 * `ui-glyph` is how the themes draw icons in their own styles without a component knowing which
 * runs. Its hosts are the two icon renderers: `GlyphIcon` for a registry glyph (a path the
 * registry does not hold gets no hook and stays a line everywhere) and `GlyphMark` for the marks
 * drawn as components (the caret, the check, the plus, the trays, the close cross, the collapse
 * chevron). Each draws the glyph three times inside its `<svg>`, one direct child per set: the
 * `line` group (the stroke drawing on the host's grid, with an optional `duo` body under it), the
 * `octicons` svg (GitHub's 16-grid filled drawing, scaled to the box) and the `pixel` svg (a
 * 16x16 drawing on crisp edges, laid out one cell to a CSS pixel from a 13px box up, so it spills
 * a little past a box under 16px). The foundation shows the line set, hides the other two and sets
 * the duo body's opacity from `--ui-icon-duo-opacity`; Primer shows the Octicons, Console the
 * pixel drawings, and Frost keeps the line drawings with their duotone bodies. A host's
 * transform (a chevron's turn, an activity mark's motion) moves all three together.
 */
export const HOOKS = [
  "ui-glass",
  "ui-eyebrow",
  "ui-display",
  "ui-live",
  "ui-frame",
  "ui-underline-nav",
  "ui-shell",
  "ui-icon-decor",
  "ui-tree",
  "ui-field",
  "ui-activity",
  "ui-notice",
  "ui-chart",
  "ui-scrim",
  "ui-stream",
  "ui-glyph",
] as const;

export type HookName = (typeof HOOKS)[number];
