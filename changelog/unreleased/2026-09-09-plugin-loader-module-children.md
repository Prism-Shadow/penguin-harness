# A plugin's modules nest as the platform's do, and a reused plugin is keyed by the file

- **Date:** 2026-09-09
- **Type:** feat
- **Scope:** `server`

[中文版](2026-09-09-plugin-loader-module-children.zh.md)

A plugin module's children are the classes its `@Module({ children })` names, nested under it the way the platform's own modules are; the platform receives only the roots. A child that is not a module class of the package, or one named by two parents, fails by name at load time rather than as a shape error deeper in the boot.

The plugin host's reuse of an already-imported module is keyed by the file the specifier resolves to, not by the specifier alone: a push writes the builtin plugins to a new assets directory, so the same specifier can name different bytes, and matching on the name kept the previous build's code running after a push.

This is the state the plugin loader had reached on the branch line the Discord plugin was written against; it is brought over here so that work applies unchanged.
