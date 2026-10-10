# A code plugin contributes the Skills it ships

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `server`, `plugins`

[中文版](2026-10-09-skills-via-contributes.zh.md)

A plugin that carries code had no way to give an Agent a Skill: its own README said so, and the Skill reached an Agent only by hand.

## Changes

- A module declares the skill directories its package ships on the new `PluginSkillsProvider.skills` slot: `{ id, path }`, the path relative to the package root and kept inside it. The declaration is manifest data — listed and type-checked without running the package — and per entry non-fatal: a path that escapes the package, a directory without a readable SKILL.md, a name the pattern refuses, or a module with no package behind it is skipped with its reason, leaving the rest installable.
- While the package is enabled (a Project's `[plugins]` lists it), its skills install onto an Agent through the plugin install route by the package name — the same route, the same writer and the same runtime invalidation as the library's. A name the library does not carry resolves against the enabled code plugins; a name neither answers is a 404, and nothing is installed. A plugin no Project lists contributes nothing: its name stops answering, and what an Agent already installed stays.
- The installed-plugins row of a plugin the process runs offers its skills as installable, metadata only.
- The example music plugin declares its `send-music` Skill on the slot, and its README installs it through the route instead of by hand.
