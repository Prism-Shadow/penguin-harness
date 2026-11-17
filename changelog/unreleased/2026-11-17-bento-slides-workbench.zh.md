# Bento 幻灯片带上 AI PPT 工作台

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `plugins`, `docs`
- **PR:** [#1585](https://github.com/Prism-Shadow/penguin-harness/pull/1585)

[English](2026-11-17-bento-slides-workbench.md)

内置的 `use-bento-slides` 插件在 Skill 之外带上了幻灯片工作台（`slides`，即 AI PPT 工作台）：Agent 对话旁的标签页里是 Bento 的幻灯片编辑器，用户修改文稿的同时，Agent 修改同一份文稿，双方的修改都会保留。该插件是预装插件，因此新建 Project 的 `default_agent` 带有**幻灯片**标签页和应用中心里的 **AI PPT**；已有的 Agent 在应用 Agents 页提示的插件更新后获得该工作台。

## 细节

- 一份文稿是一个文件：工作台与其 Agent 共用的文件目录下的 `.files/decks/<id>.bento.json`，内容即 `.bento.html` 在 `#bento-doc` 块里携带的 JSON，从不包含 `collab`；页面写入时每个幻灯片头、元素与资源各占一行。页面保存用户的修改时带上修改所基于的修订；若 Agent 此后写过该文件，处理器以 `409` 返回文件内容，页面按幻灯片与元素的 id 把用户未保存的修改重放到 Agent 的版本上。双方设置了同一个属性时保留用户的值，页面会提示。
- 处理器把被一方替换的版本保留在 `.files/history/<id>/` 下，每份文稿最近二十个。**历史版本**菜单列出它们，并能把其中一个作为用户自己的修改恢复（像修改一样保存，可用 Bento 的撤销还原）。文稿选择器里点两次即可删除一份文稿，它的历史版本和对话一并删除。打开中的文稿文件被删除时，页面不再保存，并提供把屏幕上的内容另存为新文稿；事件流重连后，页面重新读取打开中的文稿。
- 编辑器旁的侧栏把请求交给 Agent 执行，每份文稿一个 Session，请求中写明文稿文件、用户所在的幻灯片和选中的元素，并随生成显示回答。请求要求 Agent 使用 `bento-slides` Skill。
- 编辑器运行 Bento 1.2.13，原样随附为 `ui/vendor/bento-slides-1.2.13.runtime.txt`（735,819 字节，MIT），在没有自身源、策略不允许任何连接的沙盒框架里运行。**导出**写出一个自成一体的 `.bento.html`；**导入**接受这样的文件或文稿的 `.json`。在不提供工作台文件的服务端上，标签页提示需要更新的 PenguinHarness。
- `bento-slides` Skill（`2026.11.17.1`）合并了工作台自带的 Skill：覆盖工作台里的文稿（所在位置、每一步一次读改写、保留 id）与独立的 `.bento.html` 文件；工作台已安装且请求未指名文件时优先在工作台里制作；并随附 Bento 的 Agent 指南（`references/bento-agents.md`，指南 1.2.13，原样），不再让 Agent 下载。
- 插件卡片以两种语言描述这两部分，快速开始在工作台里制作一份文稿。插件新增 `README.md`、`README.zh.md` 与 `THIRD-PARTY-NOTICES.md`，以及合并逻辑与处理器的测试。内置插件表与「Skill 与插件」文档页的「Workbench 插件」一节介绍了该工作台。
- 设计：[penguin-harness-design#470](https://github.com/Prism-Shadow/penguin-harness-design/pull/470)。基于工作台文件 [#1579](https://github.com/Prism-Shadow/penguin-harness/pull/1579)。
