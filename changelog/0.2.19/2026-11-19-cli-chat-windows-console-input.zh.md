# Windows 上桌面应用的 `penguin` 从控制台读取各类提示的输入

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `cli`, `server`
- **PR:** [#1634](https://github.com/Prism-Shadow/penguin-harness/pull/1634)
- **Issue:** [#1629](https://github.com/Prism-Shadow/penguin-harness/issues/1629)

[English](2026-11-19-cli-chat-windows-console-input.md)

在 Windows 上，经桌面应用提供的 `penguin` 命令运行 `penguin chat` 时，横幅和提示符出现后会立即回到 shell，cmd 与 PowerShell 都是如此。这个命令以应用自带的可执行文件作为 Node 运行 CLI。该可执行文件是 GUI 程序，Windows 不给它控制台输入，Node 便把空的 stdin 当作输入结束。其他提示读到的也是这个空 stdin：`penguin run` 不经询问就拒绝每一次工具审批，`penguin auth login` 跳过账号询问，并在密码提示处结束。现在遇到这种情况时，各类提示都直接打开控制台输入（`CONIN$`），按键、原始模式与 Ctrl-C 都与在任何终端里一样。

## 细节

- 以这种方式读取控制台的提示：
  - `penguin chat`；
  - `penguin run` 与 `penguin session input` 的工具审批；
  - `penguin auth login` 的账号与密码提示，密码仍不回显；
  - `penguin config lang` 的 y/N 确认；
  - `penguin update` 的 y/N 确认；
  - `penguin browser exec -` 从 stdin 读取的脚本。

  `penguin config lang` 与 `penguin update` 在 Windows 上会在询问之前拒绝执行，因此它们的提示要等这两个命令能在 Windows 上运行时才会读取控制台。
- 只有在桌面运行时（Electron 作为 Node 运行）上、且 stdin 是 NUL 设备或缺失时，CLI 才改读控制台输入。来自管道或文件的输入照原样读取。输出被捕获的桌面版 CLI（例如 Agent 执行的命令）没有可读的控制台，仍使用原来的 stdin。`install.ps1` 与 npm 安装的 `penguin` 运行在 Node 上，始终拿得到控制台输入。
- 服务端为应用内终端和 Agent 写下的 `<root>\bin\penguin.cmd` 运行的是同一个可执行文件，因此这些提示在应用内终端里也能正常使用。
- 新增一项测试：在真实的伪终端（Windows 上为 ConPTY）中运行构建后的 CLI，输入一条对话命令、回答一次 `penguin run` 审批，并用 `penguin auth login` 登录，检查到达服务端的内容以及密码从不显示。在 Windows 上，对话经两种启动脚本运行：运行 Node 的 cmd 脚本，以及将 Electron 作为 Node 运行的 cmd 脚本；审批与登录经后者运行。
