# 修正落地页与 README 中已不再成立的表述

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `landing`, `docs`, `skills`
- **PR:** [#481](https://github.com/Prism-Shadow/penguin-harness/pull/481)

[English](2026-08-27-landing-readme-stale-copy.md)

清查了落地页的两份文案词典与根目录的两份 README，把其中已不再成立的说法逐条修正，中英文同步落地。

## 细节

- **下载页的「首次启动常见问题」删去 macOS 与 Windows 两项。** 原文告诉访客当前构建未签名，并引导用 `sudo xattr -rd` 删除 macOS 隔离标记、在 Windows SmartScreen 中选择「仍要运行」。macOS 安装包自 0.2.2 起已由 Developer ID 签名并公证，Windows 安装程序自 0.2.4 起已 Authenticode 签名，两条指引都已不适用。引言改为说明签名状态，只保留 Linux AppImage 执行权限这一项真实存在的首次启动处理。`MAC_UNQUARANTINE_CMD` 随其所服务的条目一并移除。
- **`README.md` 与 `README.zh.md` 同样删去这两个 `<details>` 折叠块与「当前构建暂未签名」一句**，保留 Linux AppImage 折叠块。
- **内置 Skill 清单补上此后加入库中的五个 Skill**——办公效率组的 `bento-slides` 与 `humanizer`、软件开发组的 `remote-claude-code`、AI 应用开发组的 `penguin-orchestration` 与 `skill-porting`。落地页的 Skill 区块与两份 README 的表格同步更新，顺序与 Skill 文档一致。
- **Skill 清单改为由测试锁定到实际发布的库。** `packages/landing/test/skills-sync.test.ts` 断言两份词典的 Skill 区块恰好列出 `packages/skills/skills/` 下的全部目录，且同一个 Skill 在两份词典里落在同一张卡片上；`packages/skills/test/skills.test.ts` 把原有的 README 校验扩展到两份根 README，与该包自身的 README 一并覆盖，并按表头逐行对照 `SKILL_GROUPS` 中对应的分组。两者都只比较集合而不比较顺序，并在失败信息中点名出问题的 Skill 或分组。
- **两份 README 的支持模型表按 `packages/core/src/state/model-catalog.ts` 重新推导。** 该表声明每个系列只列最新一代，因此 `GLM 5.2` 改为 `GLM 5.3`、`Gemini 3.6 Flash` 改为 `Gemini 3.7 Flash`；`GPT 5.6` 在 OpenRouter 之外补上 OpenAI 直连分组；DeepSeek V4、Kimi K3、GLM 与 Qwen 3.8 Max 各行补上 TokenDance 分组，Kimi K3 另补 Fireworks AI。
- **功能区块的副标题不再声称与 Web 界面菜单一一对应。** 独立的「轨迹」页面已经移除——Trace 改在会话自己的面板里查看——而该区块列出的能力本就有若干从不是菜单项。副标题改为说明这些能力都在 Web 界面之内，与区块实际展示的内容一致。
