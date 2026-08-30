# A hot-pushed bundle finds the skill library through the installation that loaded it

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `skills`
- **PR:** [#548](https://github.com/Prism-Shadow/penguin-harness/pull/548)

[中文版](2026-08-30-pushed-skills-root.zh.md)

The skill library was located one directory above the module reading it — the package's own `skills/`, and equally the desktop app's `<app>/skills` beside `<app>/dist`. A hot-pushed bundle runs out of `<root>/hmr/store/<kind>/` and carries no library beside it, so the lookup named a `store/skills` that never exists, and a pushed version booting a **fresh** data root died on its first skill scan (`ENOENT … store/skills`) while a root whose default Project already existed never noticed. Every remote install from the Machines page is such a fresh root.

## Details

- The library root is now resolved once, on first use, from the first of these that exists: `PENGUIN_SKILLS_DIR`; the package's own `../skills`; and, relative to the process entry (`process.argv[1]`), the installation's shipped copy — `<program>/lib/node_modules/@prismshadow/penguin-skills/skills` for an installed program, `<app>/skills` for the desktop app. When none exists the package layout is used as before.
- `resolveSkillsRoot` is exported and unit-tested for each layout.
