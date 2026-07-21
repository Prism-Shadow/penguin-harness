# Changelog Details

The root [../CHANGELOG.md](../CHANGELOG.md) keeps one brief line per release. Each release owns a folder here:

- `<version>/README.md` — the release summary: one brief line per change, each linking its detail file, e.g. `- [YYYY-MM-DD] Brief description. ([details](YYYY-MM-DD-short-slug.md))`
- `<version>/YYYY-MM-DD-short-slug.md` — one detail file per entry, named by the entry date: an H1 title, then what changed and why, using `##` sections once the entry covers more than one thing.
- Entries are grouped by the surface they change — Models, Web App, landing site, skills, docs, tooling — rather than one file per commit. A related change extends the existing file and its summary line instead of opening a new one.
- Changes not yet released go into the upcoming version's folder; during release preparation, rename the folder if the number changed and add the release line to the root file. Released folders are frozen.

Written in English. History starts after the v0.0.1 release (2026-07-19); earlier changes are not backfilled.
