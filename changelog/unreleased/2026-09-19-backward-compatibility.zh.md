# 向后兼容

- **Date:** 2026-09-19
- **Type:** process
- **Scope:** `server`

[English](2026-09-19-backward-compatibility.md)

这是 [2026-09-15-backward-compatibility.zh.md](2026-09-15-backward-compatibility.zh.md) 所述问题的另一半。被本线早期构建打开过的数据根，按那时的编号被标为 6——机器列在 5、会话 surface 列在 6——而在已发布的编号里，这个版本意味着昵称头像迁移（5）与 `company-mode-org-caches`（6）**都**已执行。`user-profile-adoption` 补跑了前者；后者没有任何东西补跑：迁移 7、8 只建各自的表，于是这样的数据根到达最新版本时缺少 `org_sessions`、`org_ticket_sessions`、`org_calendar_state`、`org_ticket_state` 与 `org_budget_state`，而创建会话要写前两张表，结果是 500「no such table」。凡是被仍在旧线上的服务器交付了本构建的机器，都出现了这个问题。

编号为 13 的迁移 `company-mode-org-caches-adoption` 重新执行迁移 6 自己的语句（全部是 `CREATE TABLE IF NOT EXISTS`），并再次删除已被迁移 7 取代的两张聊天表。用户无需手动处理：它是 `swapSafe` 的，在下一次启动或下一次推送时执行；按正常位置执行过迁移 6 的数据根会发现表已存在，不受影响。

## 兼容性

与 `user-profile-adoption` 一起移除：当不再有数据根可能运行过那些早期构建时——机器这条线自身的发布即是时点——两者都只是从 `MIGRATIONS` 里删掉一个条目。
