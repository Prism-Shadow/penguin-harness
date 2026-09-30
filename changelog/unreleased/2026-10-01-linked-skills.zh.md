# 从技能管理工具链接进来的 Skill 可以加载

- **Date:** 2026-10-01
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `docs`

[English](2026-10-01-linked-skills.md)

`agent_state/skills/` 或 `hooks/` 下的 Skill 或钩子包可以是指向别处目录的软链接——技能管理工具就是这样只保留一份 Skill、再链接到各个工具里，改一处即处处生效。此前这类链接会被跳过；现在它与复制进来的 Skill 一样被列出、加载和计数。

- 在链接进来的 Skill 上安装或更新会以 `409 skill_linked` 拒绝（请在原处更新；替换会把链接变成一份私有副本）。
- 卸载链接进来的 Skill 只删除链接，从不删除共享的那一份。
- 目标已不存在的链接会被忽略。
