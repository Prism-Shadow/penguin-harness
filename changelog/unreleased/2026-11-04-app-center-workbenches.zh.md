# 应用中心改为 Workbench 快捷入口的桌面

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`, `docs`, `rfcs`

[English](2026-11-04-app-center-workbenches.md)

侧栏新增**应用中心**入口（`/apps`），缺省收藏，排在智能体之后。本服务端该 Project 各 Agent 的工作台中，凡自己的 `package.json` 声明了 `penguin.appCenter.show: true` 的，在这里各占一个图块；点击图块以整页打开工作台，整页的退出按钮回到应用中心。

## 细节

- 工作台清单新增 `penguin.appCenter { show, title?, titleZh?, icon?, tab? }`。标题缺省取首个标签页的标题，再缺省取包名；`icon` 为 `ui/` 下不超过 256 KB 的 `.svg`、`.png` 或 `.webp` 文件；`tab` 指定快捷入口打开的标签页。声明不合规不会让加载失败：该工作台不出现在应用中心，加载提示与 `.build/status.json` 写明如何修正。`WorkbenchInfo.appCenter` 给出解析后的声明。
- `GET /api/projects/:projectId/app-center` 列出快捷入口（`AppCenterShortcut`）：按 Agent 列表顺序、同一 Agent 内按标题，附图标地址、整页路径，上次加载失败时带 `broken` 标记。它只读清单与各目录的加载状态，不编译任何东西，只列本服务端的 Agent。
- `PATCH /api/projects/:projectId/agents/:agentId/workbenches/:id/app-center` `{ show }` 只改写工作台 `package.json` 中的 `penguin.appCenter.show`（2 空格缩进，其余键不变），随后重新加载并记为一个版本。`package.json` 不是 JSON 对象时应答 409 `workbench_manifest_invalid`。
- Agent 设置的工作台标签页中，本服务端 Agent 的每一行新增**显示在应用中心**开关（即拨即存），开启的行带**应用中心**胶囊。
- 没有快捷入口时，页面说明工作台是什么，并提供**用 AI 创建**：以 `web-design` 与 `penguin-plugin` 两个 Skill 打开新对话，请 Agent 做一个出现在应用中心的工作台。
- `penguin-support` 插件的 Support 工作台声明 `appCenter: { show: true, icon: "ui/icon.svg" }` 并换上新图标，`penguin.version` 改为 `2026.11.04.1`。`penguin_support` 上已装的副本会报告一次插件更新，更新后出现在应用中心。
- `penguin-plugin` Skill（`2026.11.04.2`）新增讲解该清单键的「App Center」一节。
- [#595](https://github.com/Prism-Shadow/penguin-harness/pull/595) 的外部应用注册表、探活、`[app_center]` 来源块、`penguin app` CLI 与 `app-center` Skill 不予采纳。
- `rfcs/PRFC-0020-agent-workbench.md` 升至 v1.1.0，新增「应用中心」一节。
