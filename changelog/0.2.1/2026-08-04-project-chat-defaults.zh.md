# Web App：逐 Project 的新会话默认值

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#191](https://github.com/Prism-Shadow/penguin-harness/pull/191)

[English](2026-08-04-project-chat-defaults.md)

Project 设置新增一节「新会话默认值」（所有者可编辑，成员只读；位于 Members 之下，排布为紧凑的两列网格）：创建会话时施加的默认 Agent、工作目录（留空表示自动临时目录）、审批模式与思考等级。工作区与模型控件用的就是输入区自己的拾取器——草稿视图的目录浏览器与聊天输入的模型拾取器被抽取为共享组件（`workspace-select.tsx`、`model-select.tsx`），两处原有界面也重构到它们之上，因此设置对话框与输入区渲染的是同一份实现。在对话框中它们穿上一个 `form` 触发变体，采用对话框自己的字段设计 Token（输入区保留其药丸触发器，逐字节不变），它们的菜单绘制在模态之上，而模态原本私有的 Escape 栈被推广为一个共享的 esc-layer 栈，因此 Escape 会先关闭最上层的东西——先菜单，再对话框。这些取值存放在 `.project_config.toml` 中一个可选的 `[default_chat]` 表里——`agent_id`、`workspace`、`approval_mode`、`thinking_level`——由成员级 `GET` 与所有者级 `PUT /api/projects/:p/chat-defaults` 提供服务；该 PUT 是声明式的整块替换（省略某个键即清除它），会拒绝未知 Agent 与非法枚举值，并对 TOML 做读-改-写，因此模型与凭证不受触碰。

草稿视图在任何更具体的来源之下以这些值作为种子：路由状态（例如从 Agent 行点「新建会话」）优先于未发送的草稿，草稿优先于 Project 默认值，Project 默认值优先于此前那些硬编码兜底。模型那一行刻意不新增任何键：它渲染并写入模型页所拥有的同一个顶层 `default_model`，经一个窄口径的所有者级 `PUT /api/projects/:p/models/default` 完成，并校验其在模型表中的存在性；而修改它会像模型页那样释放任何被草稿钉住的模型（两处界面现在共用那个助手）。

思考等级的解析顺序是：Agent 显式的 `model.thinking_level`，否则 Project 默认值，否则 `medium`。草稿拾取器显示生效值，而一次选择仍然写入 Agent 自己的配置——Project 的取值永远只是兜底。随之而来一处刻意的行为变化：一个没有显式等级的 Agent 配置现在跟随 Project 默认值，而此前它总是意味着内置默认值。

这个表块是增量式的——没有它的配置行为与此前完全一致，也不运行任何迁移。有一个版本偏斜的注意事项：较旧的 penguin CLI（0.2.0 及更早）在重写 Project 配置时会丢掉这个表块，因为它的加载器是按已知键重建字面量的；当前代码则能原样往返。TOML 渲染器也学会了把表值键排在标量键之后，因此稍后追加的一个标量（比如给一份缺少 `name` 的配置做重命名）不会再被解析进它前面的那个表里。
