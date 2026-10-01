# Each theme draws its own icons; Frost frosts the sidebar; Console has one tag

- **Date:** 2026-10-01
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-10-01-theme-icons-and-surfaces.zh.md)

A theme round across all three themes, plus the restyle of the components that landed during the UI-package migration.

## Changes

- **Icons:** every glyph the app draws now lives in one registry. The 53 that feature files kept to themselves moved in. Each theme draws the registry its own way:
  - Primer uses GitHub's Octicons.
  - Frost keeps the line icons with a soft filled body under them, and its decorative icons take a hue per concept: agents violet, models blue, plugins green, and so on.
  - Console draws 16×16 pixel icons with crisp edges.
  - The small marks (caret, check, plus, close, chevrons) follow too.
  - The Credits page credits Octicons (MIT) and Lucide (ISC).
- **Frost glass:** a dialog's backdrop only dims the page now. The sidebar is a translucent column over a soft colour field, and plugin and skill tiles are frosted in their own hue. Menus and popovers keep their glass.
- **Frost fixes:**
  - The initial-password banner keeps its whole lower edge and shadow, on the new-chat page and above the chat header.
  - Dialog head and foot rules are gone.
  - Menu rows sit inside the panel's rounded corners.
  - The segmented control's selected thumb is concentric with its track. This applies in every theme.
- **Console tags:** every badge and count is one square outlined tag. Hand-made tags on the plugins, models, machines, goal, trace and company pages became badges. Capsule-shaped controls take the theme's pill radius, which is square in Console.
- **Sidebar:** a page entry's 常驻 (always shown) toggle is a lock, closed while the entry is pinned. An entry's update dot moves left of the toggle instead of sharing its place.
- **Drag previews:** dragging a sidebar entry, a session row, a group header or a model group shows an opaque card in the theme's surface. Before, the browser drew a see-through copy of the row.
- **Newer components on the UI package:** these now use the shared components and theme tokens, so Frost and Console apply to them:
  - the model picker dialog
  - the Workspace finder and workspace select
  - the built-in browser's tab strip and toolbar
  - the shortcut settings and recorder
  - the terminal key bar
