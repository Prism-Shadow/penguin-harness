# Changelog

Per-release update records, written in English. The top level holds one folder per release
version:

```text
changelog/<version>/README.md    the release summary: one line per topic, linking its topic file
changelog/<version>/<topic>.md   one file per TOPIC, collecting the related changes
```

Changes are grouped by topic rather than one file per change: a topic file starts with an H1
title and a one-line scope, then one H2 per change (title + a one-sentence summary paragraph +
details). Record a new change by appending an H2 to the matching topic file — create a new
topic file only when none fits — and keep the version README's topic list in sync. Entries
land in the next unreleased version's folder — if the latest release tag is vX.Y.Z, new
entries go into the following version (e.g. v0.0.1 released -> `0.0.2/`); released versions'
folders are frozen.

History starts after the v0.0.1 release (2026-07-19); earlier changes are not backfilled.
