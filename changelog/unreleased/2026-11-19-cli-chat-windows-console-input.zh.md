# Windows 上经桌面应用启动的 `penguin chat` 会等待输入

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1634](https://github.com/Prism-Shadow/penguin-harness/pull/1634)
- **Issue:** [#1629](https://github.com/Prism-Shadow/penguin-harness/issues/1629)

[English](2026-11-19-cli-chat-windows-console-input.md)

在 Windows 上，经桌面应用提供的 `penguin` 命令运行 `penguin chat` 时，横幅和提示符出现后会立即回到 shell，cmd 与 PowerShell 都是如此。这个命令以应用自带的可执行文件作为 Node 运行 CLI。该可执行文件是 GUI 程序，Windows 不给它控制台输入，Node 便把空的 stdin 当作输入结束。现在遇到这种情况时，对话直接打开控制台输入（`CONIN$`），按键、原始模式与 Ctrl-C 都与在任何终端里一样。

## 细节

- 只有在桌面运行时（Electron 作为 Node 运行）上、且 stdin 是 NUL 设备或缺失时，对话才改读控制台输入。来自管道或文件的输入照原样读取。`install.ps1` 与 npm 安装的 `penguin` 运行在 Node 上，始终拿得到控制台输入。
- 服务端为应用内终端和 Agent 写下的 `<root>\bin\penguin.cmd` 运行的是同一个可执行文件，因此在那里 `penguin chat` 也能正常使用。
- 新增一项测试：在真实的伪终端（Windows 上为 ConPTY）中运行构建后的 CLI，输入一条命令，确认对话作出回应、`/exit` 能结束对话。在 Windows 上覆盖两种启动脚本：运行 Node 的 cmd 脚本，以及将 Electron 作为 Node 运行的 cmd 脚本。
