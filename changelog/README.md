# Changelog Details

The root [../CHANGELOG.md](../CHANGELOG.md) keeps one brief line per release. Work in progress lives in [`unreleased/`](unreleased/); each shipped release owns a numbered folder here:

- `<folder>/README.md` — the summary: one brief line per change, each linking its detail file, e.g. `- [YYYY-MM-DD] Brief description. ([details](YYYY-MM-DD-short-slug.md))`
- `<folder>/YYYY-MM-DD-short-slug.md` — one detail file per entry, named by the entry date: an H1 title, then what changed and why, using `##` sections once the entry covers more than one thing.
- `<version>/RELEASE.md` — the announcement published verbatim as the GitHub Release body: a lead sentence, then `## Install`, `## Highlights`, `## Notable in this release`, `## Requirements`, and a closing link to this folder. Only a numbered folder has one; it is written at release, when the version is finally known.
- Entries are grouped by the surface they change — Models, Web App, landing site, skills, docs, tooling — rather than one file per commit. A related change extends the existing file and its summary line instead of opening a new one.
- Unreleased changes go in `unreleased/`, never in a numbered folder: the next version number is not knowable while the work is being written — the batch that accumulated as `0.2.0/` shipped as 0.1.1 — so a guessed number only creates a rename to get wrong later. At release, rename `unreleased/` to the version actually shipped, swap its `# Unreleased` heading for `# Version X.Y.Z` plus a `Released on <date>.` line, write `RELEASE.md`, add the release line to the root file, and create a fresh empty `unreleased/`. Released folders are frozen.
- `RELEASE.md` must be **committed before the tag is created**: the release workflow reads it from the tag's own checkout, so a file added afterwards is never published. When it is missing, the workflow falls back to notes GitHub generates from the merged PRs rather than publishing an empty body.

Written in English. History starts after the v0.0.1 release (2026-07-19); earlier changes are not backfilled.
