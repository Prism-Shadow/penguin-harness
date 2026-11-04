# 机器上的对话改从那台机器读取 Agent 的 Skill，Agent 级请求一律指明机器

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1254](https://github.com/Prism-Shadow/penguin-harness/pull/1254)

[English](2026-10-19-machine-scope-requests.md)

位于机器上的对话，其输入区的技能下拉与斜杠菜单，以及子智能体面板输入区的同一组控件，现在列出那台机器上该 Agent 已安装的 Skill。此前它们询问的是本服务端，列出的是本服务端同 id Agent 的 Skill，或者什么都没有。

## 细节

- 对话页、新对话草稿与子智能体面板经同一个 hook 读取 Agent 的 Skill，并传入 Agent 所在的机器：对话取其 Session 所在的机器，草稿取所选文件夹所在的机器，子智能体取其父 Session 所在的机器。
- Web App 中 Agent 级、Workspace（目录）级与 Project 配置级资源的请求封装都把机器改为必填参数，`null` 表示本服务端，漏传机器的调用无法通过编译。按设计属于本服务端的调用显式传入 `null`：Project 设置、模型页、插件市场、批量内核升级与插件更新、`/agent` 交接、公司模式员工与 Benchmark。
- 浏览其他机器时，Workspace 选择器不再向本服务端读取该 Agent 的配置；「从临时工作区开始」按钮的提示在那里照旧不显示路径。
