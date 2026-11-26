# 导入工作台：让 Agent 在对话中导入，或上传 zip

- **Date:** 2026-11-10
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#1525](https://github.com/Prism-Shadow/penguin-harness/pull/1525)

[English](2026-11-10-workbench-import-dialog.md)

Agent 设置页插件标签页「导入」菜单中的「工作台」打开「导入工作台」，这个弹窗换成了技能与钩子包导入所用的同一个：上方是推荐的对话导入，下方是 zip 上传。该菜单项的说明也与另外两项一致：上传 zip，或在对话中让 Agent 导入。

## 细节

- **推荐：让 Agent 在对话中导入。**「工作台来源」接受网页、GitHub 仓库或目录、本地路径、其他生态的安装命令，或一个引用、一段描述。Prompt 预览以对应来源类型的首句开头，以固定尾注结尾：安装前读完每一个文件；工作台的页面在应用内运行、服务端处理器在本服务器上运行，因此要审查它有没有外传数据、运行用不到的命令或访问自身目录之外的内容，发现可疑之处就停下、不要安装；然后按 `penguin-plugin` Skill 的包布局整理，放进以 Project 与 Agent id 点名的该 Agent 的 `agent_state/workbenches/<id>/`，并重新加载。
- 输入来源之前，「复制 Prompt」与「打开新对话」保持禁用。对话开在该 Agent 上，Agent 在哪台机器上就开在哪台机器上。已输入来源时关闭弹窗会先确认。
- 「上传工作台 zip」行为不变：同 id 已存在（409 `workbench_exists`）时先确认再覆盖，工作台的数据（`state.json`）保留。
- 技能、钩子包与工作台三种导入改用同一个共享弹窗 `chat-or-zip-import-dialog.tsx`。各自传入标题与文案、Prompt 构造函数、上传调用及其「先确认再覆盖」的 409 错误码，以及接受的文件类型。技能与钩子包弹窗的文案和行为不变。
- 文档 Agent 页的「工作台」一节写明了两种方式，「插件标签页」的列表也写明三种部件都可以上传 zip 或在对话中导入。
