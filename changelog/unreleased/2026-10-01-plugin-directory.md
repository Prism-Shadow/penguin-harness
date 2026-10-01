# Plugins: the library takes a plugin from a zip or a URL, gives it back as a zip and removes it, and both dialogs state the rules for importing and for writing one

- **Date:** 2026-10-01
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#943](https://github.com/Prism-Shadow/penguin-harness/pull/943)

[中文版](2026-10-01-plugin-directory.zh.md)

The Plugins page gained a plugin directory beside the packages the build ships: an admin installs a plugin into it from a local zip or a URL, the library lists it like any other, and its card exports it back out as a zip or deletes it. Both import dialogs state what an import accepts and what a plugin has to be.

## Importing into the directory

The routes are `POST /api/plugins/upload` (a zip carried in the request) and `POST /api/plugins/download` (a URL the server fetches), both admin-only — the directory belongs to the installation rather than to a Project, and an installed plugin's hook scripts run with the server's own rights, so the capability is the one that installs to a machine. `GET /api/plugins/directory` reads the directory line, `GET /api/plugins/:plugin/archive` exports a user plugin as a zip for any logged-in user, and `DELETE /api/plugins/:plugin` removes one.

An archive is read in two passes, because an archive is not necessarily a plugin: the central directory is scanned for every entry name — nothing inflated — to locate the plugin root, and only that root's files are inflated afterwards. The root is the shallowest directory holding a `plugin.json`, and two of them at the same depth are refused rather than guessed at; everything outside the root is ignored, so a checkout that wraps a plugin in a repository installs the plugin and not the repository. A GitHub tree URL (`…/tree/<ref>/<subdir>`) narrows the search to that subdirectory, matched on the tail of the path because the archive's own top-level `<repo>-<ref>/` directory is whatever the host wrapped it in. The caps bound the plugin rather than the archive it arrived in: 200 files, 5 MB each and 20 MB in total under the plugin root, on top of 14 MB for an uploaded zip and 32 MB for a download.

The name is taken from what the admin typed, else from the URL (a directory URL's last segment, a repository URL's repository name, a zip link's file name), else from the plugin root's directory name, and it has to match `^[A-Za-z0-9_-]+$` because it is the directory the plugin lands in. A name a built-in plugin already holds is refused — the loader would go on serving the built-in — while a user plugin of the same name answers `409 plugin_exists` until the request carries `overwrite: true`, which the dialog asks for in a confirmation instead of making the admin choose the file a second time. Every entry path is checked against zip-slip before a byte is written, and the manifest is validated by the library's own reader.

Installing is a staged swap, the same shape as a Skill install: the files land in a dot-prefixed staging directory that the loader's scan skips, are read back through the library's reader — a directory that would not load is rejected before it is committed rather than installed and silently skipped afterwards — and only then replace the real directory in one rename. The staging directory is cleared first, so a leftover from an interrupted install is never merged into the next one. The library is read from disk on every request and caches nothing, so an imported plugin is in the listing and installable the moment the request returns: no restart and no invalidation.

## The user plugin directory on the page

`<root>/plugins` holds one directory per plugin, laid out exactly like a plugin package — `plugin.json`, `icon.svg`, `skills/`, `hooks/` — so the loader needs no second format and a plugin from here is installed, updated and uninstalled like a built-in one. The page names the directory under its title with a copy button and a count of what is in it, and a card from it carries a **User** badge beside **built in**. Such a card can be exported as a zip; deleting it removes its directory from disk after a confirmation and cannot be undone. Import and delete are what an admin sees and a member does not, and the page's help text says so.

## The rules, beside the controls they govern

Both dialogs end with the same two lists, because they describe the shape a plugin has to arrive in rather than one source's mechanics, and an admin who opened the wrong dialog should still meet them. **Plugin import rules** gives the sources, where the plugin root is found, the precedence the name is decided by, the size caps and what a name collision does — ordered, because the name precedence is what a GitHub repository URL traps. **Plugin authoring rules** states what a plugin has to be for whoever is about to publish one: one directory per plugin named after it, `plugin.json` and `skills/<skill>/SKILL.md` inside it, no account details in a plugin (the AppID, keys, mail addresses and phone numbers belong to whoever installs it — read them from memory or the environment, and pass them to scripts as arguments rather than defaulting to your own), and no credentials in the directory. They are written in the product rather than in any one plugin repository's README, because a plugin outlives the repository it was published in.
