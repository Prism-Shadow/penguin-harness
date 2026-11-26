# Agent 可以有自己的头像，更换方式同个人头像

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `ui-gallery`
- **PR:** [#1506](https://github.com/Prism-Shadow/penguin-harness/pull/1506)

[English](2026-11-07-agent-avatar-upload.md)

现在可以在 Agent 设置页给 Agent 设置自己的图片。页头以 Agent 的头像开头；「概览」标签页在名称上方新增「头像」一栏：先是头像预览，再是个人资料行的两个控件，顺序相同。「更换头像」打开同一个裁剪弹窗，确认即保存；「恢复默认」会删除图片，因此先确认。头像单独保存，该页的「保存」与「重置」仍只管名称与描述。凡画该 Agent 头像的地方，都改为显示它的图片，而不是缺省的企鹅。

## 细节

- 图片是 Agent State 里的文件 `agent_state/avatar.<png|jpg|webp>`，每个 Agent 至多一个；保存新图会删去其他格式的旧图。它属于 Agent State，因此随快照及其恢复、随导出及据此新建的 Agent 一同迁移，机器上的 Agent 的图片留在那台机器上。Agent 也可以自己写这个文件。
- 新增路由：`GET /api/projects/:projectId/agents/:agentId/avatar` 提供图片，凭 Agent 列表的 `avatarRev` 作 `?rev=` 永久缓存；`PUT` 传 `{ avatar: dataUrl | null }` 设置或移除，Project 任意成员可用，返回新的 `avatarRev`。
- 账号、员工与 Agent 的头像遵循同一条规则：png、jpeg 或 webp，data URL 至多 131072 字符。图片文件另按声明的格式核对内容，手工放入超过 256 KiB 的文件不予提供。员工与 Agent 在服务端共用这条规则的同一份实现。
- 图片保持 Agent 的圆角方块，不裁成账号的圆形；加载失败时画缺省企鹅。
- 显示哪张图：公司模式里先用组织给员工的图片，其次 Agent 自己的，再次缺省画像；其他地方显示 Agent 自己的图片，没有则是缺省画像。Agents 列表、侧栏的会话行与 Agent 分组、子会话卡片、子会话面板及其拓扑图、Agent 选择器、插件库的安装对象、评估中心各页以及公司频道的成员头像组都显示它，只在设置页的「概览」里更换。
- 个人资料行、员工弹窗与 Agent 设置页共用同一个头像选择器（选取、裁剪、保存）。三处的「恢复默认」都会删除图片，因此一律先确认；员工弹窗此前直接执行。
- 组件画廊的「头像」页以 16、24、48px 展示 Agent 的图片，旁边是一张加载失败的。
