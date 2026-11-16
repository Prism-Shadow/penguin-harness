# WSL 沙盒：桌面端的文件工具可用，宿主脚本按名拒绝，goal 启动失败返回 409

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `plugins`, `server`, `docs`
- **PR:** [#1570](https://github.com/Prism-Shadow/penguin-harness/pull/1570)
- **Issue:** [#1524](https://github.com/Prism-Shadow/penguin-harness/issues/1524)

[English](2026-11-16-wsl-host-runtime-goal-start.md)

Windows 上只装了 WSL 沙盒后端时，桌面端受封禁的 Session 无法使用 `read_file`、`edit_file`、`write_file`，启动 Goal 模式则返回 `Internal server error`，两者都报 `bwrap: execvp PenguinHarness`。

## 细节

- WSL 后端把宿主自身的运行时一律映射为发行版的 `node`，不论其可执行文件叫什么；文件工具的助手由此在桌面端同样在发行版内运行，而不仅限于以 `node.exe` 启动的服务端。
- 后端拒绝「宿主运行时 + 脚本文件」的启动（钩子脚本，或以这种方式启动的 MCP Server）：该脚本的路径及其收到的宿主路径在发行版内都不存在。报错点名该脚本，并说明这样的 Session 需要完全访问；该钩子照旧失败，不会改为不封禁运行。
- 带 `goal` 的 `POST /tasks` 在 goal 插件的启动钩子失败时（脚本报错、超时或被沙盒拒绝）返回 409 `goal_start_failed`，响应带失败原因，不启动任何 Task，Session 仍可继续使用；此前是 500。
- 设置页文档、服务端 API 文档与该后端的 README 写明钩子脚本不在 WSL 后端下运行；此前设置页文档称发行版重新初始化后即可运行。
