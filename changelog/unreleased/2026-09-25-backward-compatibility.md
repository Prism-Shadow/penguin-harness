# Product tags and activity versions tables

- **Date:** 2026-09-25
- **Type:** refactor
- **Scope:** `server`

Migration 20 (`activity-product-tags`) added the `activity_product_tags` table for product
tags, and migration 21 (`activity-versions`) added the `activity_versions` table for
[saved activity versions](2026-09-25-activity-versions.md). Neither rewrote any existing row.

## Compatibility

Migration 20 is swap-safe: a pushed platform applies it without a restart, and an older
build neither reads nor writes the new table. Rolling it back drops the table and loses only
the tags. Deleting an activity sets the existing `activities.archived` column, which every
earlier reader already skips, so an older build does not list deleted activities either.

Migration 21 is swap-safe in the same way: an older build neither reads nor writes the table.
Rolling it back drops the table and loses the version list; the version blobs stay on disk,
where nothing reads them.
