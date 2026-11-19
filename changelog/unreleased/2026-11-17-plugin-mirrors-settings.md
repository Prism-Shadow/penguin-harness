# The plugin install chain reaches its mirrors through a Settings page, not a deployment config

- **Date:** 2026-11-17
- **Type:** change
- **Scope:** `server`

[中文版](2026-11-17-plugin-mirrors-settings.zh.md)

The published index's CDN mirrors were a deployment-side environment variable holding a JSON
array of rewrite rules — a shape a user could not reach and a format a user should not have
to write. The mirrors are now a settings group on the Settings dialog's Plugins page
(Plugin mirrors): a list of the mirrors this build knows, tried in the order chosen, after
the source's own URL, with the built-in rules mapping the two fetches' URLs onto each
mirror's own shape. The default runs no mirror: the source's own URL only. A change applies
without a restart.

Everything a mirror serves is verified exactly as the canonical source's — the index
document goes through the same parser, every release asset is checked against the entry's
sha512, and npm's own install record is verified after the fact — so a mirror costs a failed
fetch, never tampered bytes on disk. The rules are this build's own, fixed shapes; no
user-written pattern ever reaches a fetch.

The environment variable and the deployment-level rule list are gone: a mirror is a service
choice a user makes, not a deployment config. Where npm fetches the packages themselves from
remains the Plugin sources group beside it.
