# A plugin's manifest can nest its modules, and a reused plugin is keyed by the file

- **Date:** 2026-09-09
- **Type:** feat
- **Scope:** `server`

[中文版](2026-09-09-plugin-loader-module-children.zh.md)

A manifest's `children` names other modules of the same package. The booter wants that hierarchy as nested definitions and checks each node's children against its manifest, so the loader now builds the tree and hands the platform only its roots. A child named by two parents, a child the package does not define, and a keyed child (which a plugin cannot supply) each fail by name at load time rather than as a shape error deeper in the boot.

The plugin host's reuse of an already-imported module is keyed by the file the specifier resolves to, not by the specifier alone: a push writes the builtin plugins to a new assets directory, so the same specifier can name different bytes, and matching on the name kept the previous build's code running after a push.

This is the state the plugin loader had reached on the branch line the Discord plugin was written against; it is brought over here so that work applies unchanged.
