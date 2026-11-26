# 将四个开发 skill 更新到 0.2.20 的仓库状态

- **Date:** 2026-11-27
- **Type:** process
- **Scope:** `skills`

[English](2026-11-27-refresh-agent-skills.md)

将 `.agents/skills/` 下的四个开发 skill 按 0.2.20 的仓库状态更新，并修正了与代码不符的陈述。

## 细节

- `penguin-harness-dev`：将包地图更新为覆盖 `packages/*` 与 `library/*`，写明 server、CLI 和 desktop 是插件宿主，将模型目录参考迁到 `library/model`，删除预置默认模型的流程，修正定价、促销与 preset 同步的语义，在验证链中加入 `pnpm lint`，替换 Markdown 的 `format:check` 行，并更新插件测试名、Windows 任务名、release 版本表、`Breaking` 翻译规则、MMSP 包名与 ai-slop 的 vendored 布局。
- `penguin-harness-frontend`：用 `TEXT_SIZE_PX` 及五档替换 `FONT_SCALE_PX`，补上 `link` tone 与 `window-controls` 层级，把主题数更新为四套，并修正 `FORM_MODULES`、workbench 加载失败规则、`VARIANT`、站点语言菜单、`toastApiError`、Primer 暗色值、icon-registry 白名单与页头包装。
- `penguin-harness-manual-test`：修正种子管理员密码、按端口命名的 session cookie 与 Windows 数据根。
- `penguin-harness-writing`：将 docs profile 限定为任务页，为 `translate` 补上 `--version-note`，删除博客 slug 列表步骤，使 advisory 与 unstrip 守卫与脚本一致，并补全 `--help`。
- 将截图拍摄规则、博客资产托管与 release polish 指令各归一处，其余参考指向它。
