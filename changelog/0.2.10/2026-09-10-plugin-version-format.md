# Plugin versions are spelled `v2026.09.10.1`

- **Date:** 2026-09-10
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#666](https://github.com/Prism-Shadow/penguin-harness/pull/666)

[中文版](2026-09-10-plugin-version-format.zh.md)

A plugin's dated version — the one `plugin.json` declares and the library card shows — is now
written `vYYYY.MM.DD.N` with a leading `v` and dots throughout: `v2026.09.10.1` where it read
`2026-09-10.1`. The date and the sequence number are unchanged, and so is everything the version
means; only the spelling moved. This is the plugin's own content version and is unrelated to the
npm version of its package, which follows the release.

## The format

- `PLUGIN_VERSION_PATTERN` is `/^v\d{4}\.\d{2}\.\d{2}\.\d+$/`, and a library `plugin.json` must
  match it: the manifest check now rejects anything else with `version must be vYYYY.MM.DD.N`.
- All twelve built-in manifests were rewritten in place, each keeping its date and sequence
  number (`2026-07-20.1` → `v2026.07.20.1`). `continual-learning` additionally moves to
  `v2026.09.10.1`, a real content bump: its stop-hook prompt now asks the agent to bump a
  SKILL.md version in the new format.
- Installs are unchanged in kind — the loader stamps the plugin's version string into each
  installed `SKILL.md` frontmatter and into the generated `hooks.json` exactly as it stands.
- The zip export filename suffix is `-<version>` rather than `-v<version>`, since the `v` is now
  part of the version: `penguin-sdk-v2026.09.10.1.zip`.

## Reading both spellings

`parsePluginVersion(version): { date: string; seq: number } | null` reads either spelling into
the date and sequence number both denote, and `comparePluginVersions` is built on it, so
`2026-09-02.1` and `v2026.09.02.1` compare equal. Frontmatter and manifest parsing of installed
copies accepts both; only the library's own manifests are held to the new spelling. What that
buys and when the legacy arm can be deleted is in
[`2026-09-02-backward-compatibility`](2026-09-02-backward-compatibility.md).

## Copy that spells the format out

The plugin card's metadata line prints the version as it stands (no `v` prepended) and reads the
relative date off the new form. The hook-import prompt tail asks the agent for a `hooks.json`
`version` in the `vYYYY.MM.DD.N` format, identically in both dictionaries, and the plugin
documentation's `version` row, comparison example and manifest samples moved with it.
