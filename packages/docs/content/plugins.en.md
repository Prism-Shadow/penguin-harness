---
title: Plugins
description: What a PenguinHarness plugin is, the format a plugin package follows and how it is checked, where plugins come from, and how one is shared — through the plugin index, npm or a local link.
---

A plugin is a set of penguin modules: the unit the harness itself is built from (see [Server Boot](/server-boot#what-a-plugin-is) and the design documents PRFC-0001 "Module" and PRFC-0003 "Plugin", which the repository carries under `rfcs/`). A plugin is an npm package. Installing it puts its modules into the server's tree or its Skills, hook package, MCP servers and workbenches into an agent's Agent State — the tasks around that live on [Skills & Plugins](/skills#how-it-works). This page is about the package itself: its format, where plugins come from, and how one is shared — through the plugin index, npm or a local link.

## The format

A plugin package is an npm package whose `package.json` carries npm's own fields only. What the plugin carries is declared in its entry source: an empty class whose `@Component` decorator lists, as contributions to the server's `PluginLibraryModule`, the plugin's card, its Skills, its hook package, its MCP servers and its workbenches, and a default export `{ modules, replaces }` of the server modules it adds. The package's build runs `penguin-gen-ifaces` over its own tsconfig and writes that declaration into `ifaces.json` beside its `package.json`; that table is what the server reads, and it never runs the package. The field tables, the directory layout and a worked example are in [How it works](/skills#plugin-file-format).

All of these are plugins, and one format covers them all. What differs is where a package's contents land when installed: its contributions to `PluginLibraryModule` — Skills, hooks, MCP servers, workbenches, a card — land in an agent's Agent State, and a package carrying only those needs no code entry point (`goal` is the worked example); the server modules its default export lists — a sandbox backend, for example — land in the server's module tree. One package can carry both.

A server module needs a platform at least as new as the slots it contributes to. A slot is a named contribution point, such as a route group in `HttpModule.routes`. Every slot, and every field of a slot's data, arrives with some release. An older platform does not know a newer slot, or a newer field such as a route group's `origin`. Its check then drops every contribution that module makes to that slot. The plugin runs without that part of itself, and its row on the **Plugins** page says why. Built-in plugins ship with the server they run on. A package published to npm states the oldest release it needs in its README.

## Checking the format

Nothing loads a plugin package to find out what it is: the table says it. Two checks read that table and the package around it, and they agree because they read the same generated file.

- **The index CI** checks a submitted package: its manifest parses and its path spells its name, version and content hash; the metadata matches what npm serves; installing the lock produces exactly the content the hash names; the package is loadable ESM with an `activate` export; the license is allowed. These are the submission's rules, and [CONTRIBUTING](https://github.com/Prism-Shadow/penguin-harness-plugins/blob/main/CONTRIBUTING.md) in the plugin index repository is their authority.
- **Locally**, build the package (`penguin-gen-ifaces` regenerates `ifaces.json`; a stale table is refused by name) and load it the way the server does — through a Project's `[plugins]` table on a deployment, or through the loader the tests exercise. A declaration the table does not back, or a table the build did not write, is skipped with its reason reported.

## Where plugins come from

Four places, four rules:

1. **The harness's own modules** are not yours to list or submit: they live in the main packages today and are being regrouped into per-function modules (the open pull request [#1550](https://github.com/Prism-Shadow/penguin-harness/pull/1550) carries the regrouping), and they will land in the repository's plugin library directory — they are part of PenguinHarness itself, not someone else's package. See [Architecture](/architecture) for the packages as they are today.
2. **Built-in plugins** ship with the repository under `plugins/` — one npm package per plugin, listed by category in the [built-in library](/skills#built-in-library). Installing one fetches it from npm or its repository, and the desktop app packs its own set of them into the bundle. A plugin built around someone else's product carries a `use-` prefix (`use-firecrawl`), and a self-evolution toolkit's name ends in `-rsi-toolkit`.
3. **Third-party plugins** are collected into the [plugin index](https://github.com/Prism-Shadow/penguin-harness-plugins) — one entry per pull request, under the submission protocol of that repository. The server merges the index with its built-in list on the **Plugins** page; an index entry is for discovery only, and the package still installs from the channel the entry names.
4. **Your own or unlisted plugins** need no index at all: link a local directory into the server's plugin prefix with `penguin plugin link` — the directory stays where it is and is referenced in place, loaded through the same path as an installed plugin; for a published package, install it by npm name.

## Sharing a plugin

The [CONTRIBUTING](https://github.com/Prism-Shadow/penguin-harness-plugins/blob/main/CONTRIBUTING.md) guide of the plugin index repository is the authority for listing; this page and the `penguin-plugin` skill point at it and do not restate its rules — when they disagree with it, it wins. In short: publish the package (npm is the whole channel story — an entry needs at least one source the harness can fetch the tarball from, with the bytes pinned by the entry's hash), let the tooling write the entry (`pnpm new-entry <name>@<version>`), fill in `categories` and `owners`, run the local checks, and open one pull request with exactly one entry. CI decides the mechanical questions; review is human.

The `penguin-plugin` skill carries the same steps for a harness session, together with the other ways — install by npm name, or link a local directory — and a separate instance with `PENGUIN_HOME` and `penguin plugin link` for testing a package before it is shared: it drives the protocol without copying it, and the two are updated in the same change, so the step-by-step edition never drifts from the rules it drives.
