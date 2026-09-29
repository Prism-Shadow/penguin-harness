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
 * | `ui-glass`         | a transient layer over content: menus, popovers, the     | —                                                     |
 * |                    | modal card, the floating composer, a sticky page header  |                                                       |
 * | `ui-eyebrow`       | a group label naming the items below it (never directly  | —                                                     |
 * |                    | above an `h1`–`h4`)                                      |                                                       |
 * | `ui-display`       | the one display title of a page or hero                  | only on an `h1` or `[aria-level="1"]`                 |
 * | `ui-live`          | motion for something that is running right now           | `data-live="dot" \| "caret" \| "spinner"`             |
 * | `ui-frame`         | a ruled box with a head, a body, a foot and panes        | children carry `data-slot="head" \| "body" \| "foot" \| "pane"` |
 * | `ui-underline-nav` | the selected-tab marker of a tab bar                     | items `[role="tab"]`, selected by `aria-selected="true"` |
 * | `ui-shell`         | the app window: a navigation column beside a main column | children carry `data-slot="nav" \| "main"` (a right column may carry `"dock"`); the selected nav row is `[aria-current="page"]` |
 * | `ui-icon-decor`    | an icon that says nothing its label does not already say | on the icon itself (or the element holding only it); optional `data-role="nav" \| "group" \| "menu" \| "empty"` |
 * | `ui-tree`          | a container whose rows nest                              | rows carry `data-depth="0"…"8"`, the last row of a level `data-last="true"`; a row's children may follow it in a `data-branch` element carrying the children's `data-depth` |
 * | `ui-field`         | a labelled control row                                   | children carry `data-slot="label" \| "control"` and optionally `"hint"` |
 *
 * `ui-shell` is the one place a theme may paint a field of colour: Frost lays a soft warm field
 * behind the window, leaves the navigation column transparent on it and floats the main column as
 * a rounded sheet; Console rules the columns off each other with hairlines, full bleed; Primer
 * changes nothing — the window's look is its own classes.
 *
 * The three structure hooks (2026-09-19) are how the themes differ in organisation, not only in
 * colour and radius:
 *
 * - `ui-icon-decor` marks the icons a theme may recolour or drop: a nav row's glyph, a group
 *   header's, a menu row's, an empty state's illustration — never a status mark, a file kind, a
 *   tool glyph or an avatar, which carry information and stay in every theme. Primer keeps them
 *   monochrome; Frost colours them by role (the accent on navigation rows and empty states, the
 *   muted ink on group headers, a menu row's own ink — a danger row keeps its red); Console hides
 *   them, so its text marks (`>`, the eyebrow) carry the structure and it shows far fewer icons.
 *   A call site applies it by passing `decor="<role>"` to an icon renderer (`GlyphIcon`,
 *   `Glyph`), which writes the class and `data-role` for it; the hook guard reads the prop on
 *   the call site and holds the enclosing row or header to the host list. A wrapper that holds
 *   only the icon may carry the class itself instead, so a hidden icon leaves no empty box
 *   behind in a flex row.
 * - `ui-tree` marks a list whose rows nest: a file tree, a work group's tool rows under its head,
 *   a plan's sub-steps, the subagent call graph. A host indents its rows itself, by
 *   `calc(var(--ui-tree-inset) + var(--ui-tree-indent) * depth)`, so every theme's connector
 *   rules land on the same columns; rows directly under the container's own head (a work group's
 *   tool rows) are depth 1, a tree's roots depth 0, and depths past 8 draw as 8. Console draws
 *   `├─` / `└─` connector rules in CSS (no box, no glyphs in the markup) and takes the box away
 *   from a frame whose body is a tree; Frost indents against a soft guide rule and keeps its
 *   card; Primer keeps today's bordered box. A branch is a plain block holding one level's rows
 *   right after their parent row (`<li data-depth="1">` then `<div data-branch data-depth="2">`);
 *   the recipes continue the parent's rule alongside it. Rows draw with `::before` / `::after`,
 *   so a tree row carries no pseudo-elements of its own.
 * - `ui-field` marks a labelled control row — a form field or a settings row — so a theme can
 *   lay its parts out its own way: Primer keeps the host's layout (label above in a form, label
 *   left and control right in settings); Frost puts the label above and stretches the control
 *   across, roomily; Console sets a tabular row with a fixed label column
 *   (`--ui-field-label-w`) and the control left-aligned in the next, so a settings page reads
 *   like a table. The hint (or error) may be its own slot or sit inside the label slot.
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
] as const;

export type HookName = (typeof HOOKS)[number];
