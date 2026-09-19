# Backward compatibility

- **Date:** 2026-09-19
- **Type:** process
- **Scope:** `server`

[中文版](2026-09-19-backward-compatibility.zh.md)

The second half of what [2026-09-15-backward-compatibility.md](2026-09-15-backward-compatibility.md) describes. A data root that an earlier build of this line opened is stamped 6 under that build's numbering — machines columns at 5, the Session surface column at 6 — and on the released numbering that version reads as *both* the nickname-and-avatar migration (5) and `company-mode-org-caches` (6) already applied. `user-profile-adoption` re-runs the first. Nothing re-ran the second: migrations 7 and 8 create only their own tables, so such a root reached the latest version without `org_sessions`, `org_ticket_sessions`, `org_calendar_state`, `org_ticket_state` and `org_budget_state`, and creating a Session — which records into the first two — answered 500 with "no such table". It showed on every machine a server still on the old line handed this build to.

A migration numbered 13, `company-mode-org-caches-adoption`, re-runs migration 6's own statements (all `CREATE TABLE IF NOT EXISTS`) and drops again the two chat tables migration 7 had replaced. Nothing to do by hand: it is `swapSafe`, so it runs at the next start or the next push, and a root that took migration 6 in its proper place finds its tables there and is left alone.

## 兼容性

Goes together with `user-profile-adoption`: once no data root can still be running one of those earlier builds — the machines line's own release is the moment — both are single entries deleted from `MIGRATIONS`.
