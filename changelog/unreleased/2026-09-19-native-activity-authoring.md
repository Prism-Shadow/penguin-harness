# Native activity authoring foundation

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`

[中文版本](2026-09-19-native-activity-authoring.zh.md)

Penguin Harness gains the first native WAF activity-authoring foundation: collection manifests, `(productCode, refNum)` activities, file-backed drafts, validated specifications, optimistic draft conflicts, and Harness-session generation endpoints.

## Details

- Activity state is indexed in SQLite while editable drafts remain portable files.
- Generation starts a normal Harness session in the draft workspace, preserving Harness traces and approvals.
- The activity specification validator follows Loom's minimum contract and refuses incomplete output.
