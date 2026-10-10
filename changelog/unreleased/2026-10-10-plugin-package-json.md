# A plugin's manifest is its package.json, and an agent can port a foreign plugin into one

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `skills`
- **PR:** [#1024](https://github.com/Prism-Shadow/penguin-harness/pull/1024)
- **Breaking:** yes — `plugin.json` is no longer read; a plugin describes itself in its `package.json`

[中文版](2026-10-10-plugin-package-json.zh.md)

A plugin's `package.json` became its only manifest: npm's own fields plus a `penguin` block for everything that is PenguinHarness's, every field but the name and the version optional, and a missing field shown as missing. An agent can now port a plugin written for another tool — a Codex or Claude Code plugin, a skills repository, a folder in a GitHub repository — into such a package and install it on the server, from where any agent gets it with **Manage installs**.

## The manifest

- The npm fields keep their npm meaning: `name` (required; the part after the scope is the plugin name), `version` (required, semver), `description`, `keywords` (`penguin-plugin` is the discovery keyword), `author`, `license`, `homepage` and `repository`.
- The `penguin` block holds `title` / `title_zh` (a display name), `description_zh`, `short_description` / `short_description_zh`, `category`, `icon` (an SVG path in the package; `icon.svg` at the root when absent), `preinstall`, `quick_start` and `hooks` (the hook package, with its date `version`). Skills, hooks and server modules are still found by their directories.
- Core reads every package through one reader, `parsePluginPackage`. A package without a valid name or release version is refused; any other field of the wrong type is dropped with a warning naming the key. For a package the build ships, any such warning fails the library; for one an admin installed, the warning goes to the server log once and the package lists with the field missing.
- Missing fields are shown as missing: no description reads "No description" (「暂无描述」) in muted ink, no title shows the plugin name, no icon the puzzle piece, no category the Other group, no quick start pre-selects the first Skill.
- An icon is inlined only when it stays inside the package, weighs at most 64 KiB and holds no script, event handler, link or external reference; otherwise it is dropped, for a package an admin installed as well as for the index rows of server modules on this machine.
- In a package an admin installed, a Skill without a date version reads as unversioned and is never offered an update, and `hooks/` without `penguin.hooks.version` lists the Skills and no hook package. A file in a skill directory that is not UTF-8 text, such as an image, is left out instead of being installed garbled.
- The 19 shipped packages moved their `plugin.json` fields into `package.json`, gained `keywords` with `penguin-plugin`, and dropped `plugin.json` from their `files`. `scripts/check-plugin-versions.mjs` reads the hook declaration from `penguin.hooks`, and from the base commit's `plugin.json` while the base still has one.
- The plugin's details show the title with the package name beneath it, and a line with the author, the license and links to the homepage and the repository, each only when the package carries it. The search box matches the title too. `PluginItem` gained `title`, `titleZh`, `author`, `license`, `homepage` and `repository`.

## Importing a foreign plugin

- The `skill-porting` plugin gained a second Skill, `plugin-porting`: the package format, how to fetch a source at a pinned commit, how to recognise a Codex or Claude Code plugin, the field-by-field mapping into `package.json` (`reference/foreign-plugins.md`), a script that reduces each ported Skill's frontmatter to `name`, `description` and a date `version` and removes images and another tool's display metadata (`scripts/normalize-skills.mjs`), the review duties and the install. Commands that only point at a Skill, subagents, another tool's hooks, MCP servers, hosted apps and images are not carried; the package's README lists them, the MCP servers with their URL to add by hand.
- `penguin plugin install <directory>` installs a local package directory: the CLI reads it with the plugin library's reader (a package the library would refuse is reported and nothing is sent), zips it without `node_modules`, `.git` and `.npmrc`, and uploads it through the zip route. `--overwrite` replaces another version on the server.
- The import dialog's link tab refuses a link to a folder or a file inside a GitHub repository and offers **Ask an agent**, which carries the link to the agent tab; the server refuses the same links before npm runs. The agent tab's prompt names the package format and sends anything that is not a package yet through `plugin-porting`.

## Compatibility

`@penguinharness/*` packages of 0.2.13 or older that an admin installed from the npm registry into a server's prefix still load by their directories: their English description, icon, version and Skills show. What only their `plugin.json` carried — the Chinese and short descriptions, the category, the quick start and the hook package of `goal` and `continual-learning` — is missing until the admin installs a newer version of the package. An agent that already has those hooks keeps its copy.
