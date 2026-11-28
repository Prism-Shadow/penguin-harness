# The workbench operations and the admin users section sit below the domains, and the merged nodes close no new cycle

- **Date:** 2026-11-28
- **Type:** fix
- **Scope:** `web`, `library/workbench`, `library/organization`, `plugins/browser-automation`

[中文版](2026-11-28-shared-vocabulary-below-the-domains.zh.md)

The shared workbench vocabulary and the admin users section move to layers both sides reach, so the module boundary graph loses the six cycles the web halves' merge had opened. A managed-browser tab shows its URL hint even while its title is fully visible.

## Details

- The workbench source/version/removal operations (`useWorkbenchActions`, `useWorkbenchPaletteActions`, `LoadFailedActions`) and the load-failure report (`workbenchLoadFailure`, `WorkbenchLoadError`, `FailedWorkbench`) move from the workbench web half into the Web App's `lib/`, below the domains: the Agent settings and the sidebar read them directly, and the half reads them back through the host seam. The workbench package drops the deep export that named the moved file.
- The admin users section returns to the Web App's own features (`features/admin`), its own home again: the organization web half is company mode only, so importing the section no longer drags company mode — and through it the chat and plugins features — into the settings module's imports.
- The module boundary baseline sheds the six cycle records these edges had opened; the list still only shrinks.
- A managed-browser tab's hint marks itself as carrying what the screen does not show (`data-tooltip-extra`) whenever the tab's URL differs from its visible title, so the full URL stays reachable on a tab whose title fits.
