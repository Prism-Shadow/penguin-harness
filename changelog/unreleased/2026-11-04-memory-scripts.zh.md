# 记忆可以保存 Agent 反复使用的脚本

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **Breaking:** yes — 记忆导出文件升为 version 2，此次改动之前的服务端会拒绝它

[English](2026-11-04-memory-scripts.md)

记忆的作用域可以带一个 `scripts/` 目录，存放 Agent 反复使用的程序。Agent 用文件工具写下脚本，在该作用域的 `MEMORY.md` 中列一行并写明运行方式，再经 `exec_command` 运行，受该 Session 的沙盒、审批模式与命令策略约束。没有新增工具；没有 `scripts/` 的作用域行为不变。

## 提示词与内核

- 默认的记忆提示词在事实之外点明可复用的脚本，并新增 **Scripts:** 一段：模型不保存就得重写的程序放进作用域的 `scripts/`，写成一个自包含文件，开头附用法注释，在索引中记作 `- [Title](scripts/name.py) — what it does · run: python3 scripts/name.py <args>`；它经解释器按绝对路径运行，因为文件没有执行位；密钥留在 vault 里；不是本 Session 写的脚本，运行前先读。
- `KERNEL_VERSION` 改为 `2026-11-04`，记忆标签页原来的默认值记为已被取代。已有的 Agent 经**更新内核**采纳这一段；改过的记忆标签页保留原文。
- 采纳新提示词后，该 Agent 每个进行中的对话会在下一次上下文轮换时把缓存的提示词前缀重读一遍。

## 服务端

- `GET …/memory/scopes/:key/files` 在主题文件之后列出作用域的脚本。每一项都带 `kind`（`topic` 或 `script`）和 `path`：主题文件是文件名，脚本是 `scripts/<name>`。
- `GET` 与 `DELETE …/files/scripts/:name` 读取和删除脚本，删除时同时移除它在 `MEMORY.md` 中的那一行。超过 512 KB 的脚本以 413 `memory_script_too_large` 拒绝，不是 UTF-8 文本的以 415 `memory_script_not_text` 拒绝。
- `scripts` 是符号链接或普通文件时，该作用域没有脚本：其下的任何东西都不会被列出、读取或删除，向那里带入脚本的导入在写入任何内容之前以 409 `memory_scripts_not_a_directory` 拒绝。
- 导出文档为 `version: 2`：每一项以 `path` 标明位置，脚本与主题文件一同导出；超过 512 KB 或不是 UTF-8 文本的脚本改为列在 `omitted` 中，附大小与原因。一次导入至多带 100 个脚本，`replace` 会删除文档中没有的脚本。version 1 的文件照常导入，见[向后兼容](2026-11-04-backward-compatibility.zh.md)。
- Agent 列表的记忆数与各作用域的 `fileCount` 都把脚本计算在内。

## Web App

- 记忆标签页在分组的记忆下方以**脚本**列出该组的脚本，并显示每个脚本的大小与日期；标题旁的「?」说明谁可以运行、谁能读到它们。**查看**显示脚本的路径和带行号的只读代码；**删除**经确认后移除脚本。脚本没有**编辑**。
- 导出时如有脚本未写入文件，会以提示列出它们。
- 对话页的记忆面板按路径列出脚本，并以代码形式打开。对话写下的脚本不再被当作已删除而从记忆变更卡片中消失。

## 文档

- 配置 › 记忆新增「脚本」一节。Agent 页面的记忆标签页与服务端 API 的记忆路由描述了脚本和 version 2 文档。

## 兼容性

- 此版本导出的记忆文件不能导入到它之前的服务端，后者会以未知版本拒绝。请先升级那台服务端。
- 在导出路由的响应和发往导入的文档中，原来带 `name` 的条目改为带 `path`。读取 `files[].name` 的客户端改读 `files[].path`。
