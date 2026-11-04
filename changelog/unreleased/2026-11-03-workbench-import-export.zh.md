# 工作台可导入与导出 zip

- **Date:** 2026-11-03
- **Type:** feature
- **Scope:** `server`, `web`, `ui-gallery`
- **PR:** [#1444](https://github.com/Prism-Shadow/penguin-harness/pull/1444)

[English](2026-11-03-workbench-import-export.md)

工作台的源码可以下载为 zip，zip 也可以导入为工作台，与 Skill、钩子包的流转方式相同。Agent 设置的工作台标签页新增「导入 zip」按钮与每行的「打包导出」图标；两者对 Project 的所有成员开放，请求发往 Agent 所在的服务端。

## 细节

- `GET /api/projects/:p/agents/:a/workbenches/:id/archive` 返回该工作台的源码文件，置于唯一顶层目录 `<id>/` 下，文件名为 `<id>.zip`，`package.json` 带 `version` 时为 `<id>-v<version>.zip`。导出从不包含 `state.json`、隐藏条目（`.build/`、`.harness/`、`.plugin.json`）与 `node_modules/`，可原样导回。超出 Skill 归档上限的目录返回 413 `workbench_too_large`。
- `POST /api/projects/:p/agents/:a/workbenches/archive`（`{ dataBase64, overwrite? }`）接受 `package.json` 位于唯一顶层目录（目录名即 id）或 zip 根目录（此时 `package.json` 的 `name` 即 id；带 scope 的名字拒绝，并提示改用顶层目录）。`package.json` 须能解析且列出 `penguin.modules`。以下条目在写入任何文件之前以 400 拒绝，上限沿用 Skill 归档：任意大小写的 `state.json` 与 `node_modules/`、隐藏条目、越界路径、控制字符、Windows 无法保存的名字、git 保留的名字、链接，以及在不区分大小写或 Unicode 规范形式的磁盘上会被视为同一个的两个名字。
- 同 id 的目录已有 `package.json` 时返回 409 `workbench_exists`，附 `details.workbenchId`；与已有目录仅大小写不同的 id 视为该目录。带 `overwrite: true` 时源码被精确替换为 zip 中的文件（多出的源码文件删除），保留 `state.json` 与 `.plugin.json`，并删除 `.harness/`，由加载按当前宿主重新生成类型。zip 先对照目录检查，并在目录旁完整写出，被拒绝的覆盖、或磁盘写不下其文件的覆盖不改动原目录；中断的导入留下的暂存目录满一小时后由下一次导入删除；新文件的位置上有链接、或有含旧源码以外内容的目录时返回 409 `workbench_conflict`。同一个 Agent 的导入逐个进行。工作台随即加载，201 应答为 `{ workbench }`，含加载错误。
- 标签页的导入对话框在覆盖已有 id 之前先确认并写明该 id，zip 被拒绝时原因留在对话框中；导入后的提示说明工作台是否加载成功，失败时附加载错误。组件画廊的 mock API 应答这两条路由。
