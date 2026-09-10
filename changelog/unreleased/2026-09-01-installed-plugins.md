# The plugins a Project asks for, and which of them the process runs

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#383](https://github.com/Prism-Shadow/penguin-harness/pull/383)

[中文版](2026-09-01-installed-plugins.zh.md)

The Plugins page listed a catalogue to install *from* and said nothing about what this deployment actually runs. It has a surface now.

## Installed plugins

An icon beside the Plugins heading opens **Installed plugins**: what the current Project asks for (`plugins` in its `.project_config.toml`), and which of those the running process holds, as two separate facts. Asking for a plugin is consent, not a download: only a plugin the build ships can be asked for (`POST /api/projects/:p/plugins/installed { specifier }`, admin), and a name the build does not ship is refused rather than listed, so a Project never names a package that is not on the machine. Each catalogue row carries the control, so a plugin is asked for where it is read about, and the row then shows what it is for this deployment — installing, waiting for a restart, or running. Removing one (`DELETE …?specifier=`) drops it from the list; nothing on disk changes.

A listed plugin is active when the running process holds it. One the process could not load — a specifier that does not resolve, a package that is not a plugin, an import that threw, a module name another plugin already took — is reported with that reason rather than as a pending restart. `GET` (any member of the Project) and `PUT { plugins }` (admin) read and rewrite the list.
