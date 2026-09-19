/**
 * The style hooks: the closed list of `ui-*` classes a component may carry so that a theme can
 * give it a treatment tokens cannot express (a backdrop blur, a ruled frame, a stepped animation,
 * a colour field behind the app window).
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
 *
 * `ui-shell` is the one place a theme may paint a field of colour: Frost lays a soft warm field
 * behind the window, leaves the navigation column transparent on it and floats the main column as
 * a rounded sheet; Console rules the columns off each other with hairlines, full bleed; Primer
 * changes nothing — the window's look is its own classes.
 */
export const HOOKS = [
  "ui-glass",
  "ui-eyebrow",
  "ui-display",
  "ui-live",
  "ui-frame",
  "ui-underline-nav",
  "ui-shell",
] as const;

export type HookName = (typeof HOOKS)[number];
