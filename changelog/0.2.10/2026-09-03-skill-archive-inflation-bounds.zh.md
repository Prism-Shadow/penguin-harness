# Skill 压缩包的上限在解压之前生效

- **Date:** 2026-09-03
- **Type:** fix
- **Scope:** `server`
- **PR:** [#601](https://github.com/Prism-Shadow/penguin-harness/pull/601)

[English](2026-09-03-skill-archive-inflation-bounds.md)

`POST /api/projects/:p/agents/:a/skills/archive` 此前把 200 个文件、单文件 5MB、总计 20MB 三条上限，施加在 `unzipSync` 已经返回的条目上。而 `unzipSync` 会按每个条目声明的解压后大小分配缓冲区再往里解压，因此对结果做的检查什么也框不住：路由放行的 14MB 用全零压缩足以声明约 14GB，而一个把大小报大的条目返回的是指向声明长度缓冲区的一小段视图——它能通过全部检查并完成安装。

## 详情

- `unzipBounded`（`services/skill-import-limits.ts`）为 `unzipSync` 加上 `filter`，在条目解压之前从中央目录读出并施加这三条上限。压缩包路由改调用它，事后的字节与计数检查随之删除。状态码与文案不变：仍是同样的 400 与同样的文字。
- 以声明大小为界在两个方向上都是准确的——fflate 只会解压进恰好这么大的缓冲区且从不扩容，因此一个条目产出的字节只可能少于它声明的数量。
- 名字与压缩包内唯一顶层目录完全相同的文件条目，去掉前缀后只剩空路径，写入会落到 Skill 目录本身；该 `EISDIR` 此前表现为一条未处理异常日志加 500，现在与其他被拒绝的条目路径一样返回 400。
