# Changelog

Per-release update records, written in English. The top level holds one folder per release
version:

```text
changelog/<version>/README.md          the release summary: one line per change, linking its detail file
changelog/<version>/<date>-<slug>.md   one detail file per entry
```

A detail file starts with an H1 title, then a one-sentence summary paragraph (quoted verbatim
in the version README), then details. Entries land in the next unreleased version's folder —
if the latest release tag is vX.Y.Z, new entries go into the following version (e.g. v0.0.1
released -> `0.0.2/`); released versions' folders are frozen. Every new entry must also be
added to its version's README index.

History starts after the v0.0.1 release (2026-07-19); earlier changes are not backfilled.
