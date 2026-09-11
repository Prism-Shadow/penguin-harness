# The Plugins page is one list: the library's categories and the registry in one shape

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-12-plugins-page-one-list.zh.md)

The Plugins page no longer reads as two pages stacked. It is titled Plugins, and the registry — the plugin packages this deployment can install for a Project — is one more collapsible section under the library's categories, in the same container: the same group header with a count, the same borderless rows, the same icon tile in the plugin's own palette colour. A registry row keeps its tag line (license and keywords), and the "built in" mark now sits in that tag line instead of beside the Install button.

The registry section also sits inside the page's column now. It was rendered outside the width-capped container the library uses, so on a wide window it spanned the full width while the library above it stayed centered.
