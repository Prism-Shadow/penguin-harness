# Installing a plugin the build ships is refused instead of silently shadowed

- **Date:** 2026-11-27
- **Type:** fix
- **Scope:** `server`

[中文版](2026-11-27-shipped-plugin-install-refused.zh.md)

## Details

- Installing a plugin package under the name of a plugin the build ships (for example
  `@penguinharness/trace-lookup`) used to succeed: npm put the newer version into the data root's
  plugin prefix, but the plugin library reads the build's own copy ahead of the prefix, so the
  installed version was never listed or loaded — the update was silently shadowed, with no error
  and no hint on the plugin card.
- Such an install is now refused with `409 plugin_shipped` before npm runs, and the refusal says
  which version the build carries and that updating the plugin requires a build release. The same
  refusal covers a linked directory and an uploaded zip under a shipped name (the package is taken
  back out of the prefix), so every install path answers the same way. Installing a plugin the
  build does not ship is unchanged.
