# 删除定时任务只在文件确实不存在时报告 not-found

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `server`

[English](2026-10-17-schedule-unlink-not-found.md)

删除定时任务时，不再把每一种文件系统错误都答成 `schedule_not_found`。只有文件缺失才是 404；权限不足或其他 unlink 失败会按原错误抛出，而不是告诉调用方任务已经不在了。

## 细节

- `deleteScheduleFile` 只在 ENOENT 时返回 false，与它自己的注释以及组织存储里日历事件删除的写法一致。
