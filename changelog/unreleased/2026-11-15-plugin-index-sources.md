# Server: the plugin index reads a configurable list of sources

- **Date:** 2026-11-15
- **Type:** feat
- **Scope:** `server`, `web`

[中文版](2026-11-15-plugin-index-sources.zh.md)

The Plugins page reads one published index today, and a deployment that also runs an internal catalogue or a mirror has to choose. The plugin index's sources are now a settings group (`plugin-index`, on the admin Settings dialog): a switch, and a list of `index.json` addresses tried in the order written. With no address saved the release's published index is read, as before; turning the switch off lists the packages that ship with the server only, and no outbound request. A save applies without a restart.

## Details

- The sources merge into one listing first-come-first-served: the first address that registers a package provides its whole entry — description, versions and install channels — and a later address listing the same package adds nothing. An address that cannot be read is named in `failures` while the rest still list.
- The install face resolves a package's release channel over the same list with the same rule: the first registration of a package owns every row for it, so what an install fetches is what the listing shows.
- An address may be `http` as well as `https` — an internal mirror or a self-hosted catalogue. The integrity hash an entry is installed by comes from the entry itself, so an address adds no way around the verification.
