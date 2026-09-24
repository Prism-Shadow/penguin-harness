# Product tags table

- **Date:** 2026-09-25
- **Type:** refactor
- **Scope:** `server`

Migration 20 (`activity-product-tags`) added the `activity_product_tags` table for product
tags, without rewriting any existing row.

## Compatibility

The migration is swap-safe: a pushed platform applies it without a restart, and an older
build neither reads nor writes the new table. Rolling it back drops the table and loses only
the tags. Deleting an activity sets the existing `activities.archived` column, which every
earlier reader already skips, so an older build does not list deleted activities either.
