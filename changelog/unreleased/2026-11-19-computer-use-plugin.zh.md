# 电脑操作：Agent 经基于 agent-desktop 的插件操作桌面应用

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `plugins`, `server`, `docs`, `ci`
- **PR:** [#1650](https://github.com/Prism-Shadow/penguin-harness/pull/1650)

[English](2026-11-19-computer-use-plugin.md)

新插件 `@penguinharness/computer-use` 让 Agent 用 `penguin computer` 查看并操作服务端桌面上的应用，支持 macOS、Windows 与 Linux，底层是 [agent-desktop](https://github.com/vercel-labs/agent-desktop) 1.3.1。它不预装，也不随构建自带：管理员从插件市场安装，装到 Agent 上后该 Agent 获得 `computer-use` 技能。

## 细节

- agent-desktop 由插件自己安装，不经 npm。插件从「插件源」的 npm registry 下载钉死的 tarball，与钉死的 sha512 不符即拒绝，只保留本机的程序与辅助程序。两者各按钉死的 sha256 校验，以私有、单一硬链接的文件存进 `<数据根>/cache/computer-use/agent-desktop/1.3.1/`。六个目标之外的机器显示「此平台不支持」。管理员可改用以其他方式安装的程序。
- `penguin computer <command>` 是 member 插件命令。它经服务端的策略检查后原样传递 agent-desktop 的命令与参数，并打印 agent-desktop 的 JSON 信封。每条命令一个进程，按绝对路径启动，只带指定的环境变量与调用方 Session 自己的状态目录，超过它自己的时间预算即被终止。
- 谁能使用：缺省只有管理员，以及由管理员驱动对话的 Agent。「允许成员使用」开关缺省关闭，打开后所有成员都能使用；其说明写明这等于把这台机器的桌面会话交给他们控制。调用方的 Project 还须在本服务端启用了本插件。
- 插件命令的通用约定：命令可以声明 `requiresProjectListing`，此后只对 Project 为本机列出了该插件的调用方运行（否则 `403 plugin_not_enabled`）。以本机 API token 调用并指明 Session 时，调用方改为驱动该 Session 的人（与内置浏览器同一规则），成员的 Agent 因此以该成员的身份运行。
- 策略缺省放行观察与语义操作。物理输入、读取剪贴板与读取通知各需管理员打开一个开关。会作用于焦点窗口的命令必须指明应用，且名称须与 `list-apps` 打印的完全一致；别名、名称的一部分或未列出的窗口一律拒绝。属于 PenguinHarness 自身进程树的目标一律拒绝，被复用的父进程 id 不被追溯。`launch` 只接受应用名（不带 `--arg`、`--env`、`--cwd` 或 `--cdp`）。`sandbox`、`mcp`、`session`、`trace`、通知操作、调试截图、短选项组合，以及 `batch` 中的文本或 `launch` 从不运行。每次拒绝输出 `error: policy_refused: <原因与对应设置>`。
- `status` 在 `data.penguin` 下附上插件自己的状态与本机的前提条件。`screenshot` 把 PNG 作为文件交回终端，存在当前目录或 `--out-dir`。`--text-file` 从文件读取要输入的文本，经 stdin 传入。
- 设置 › 插件新增电脑操作卡片：各开关、程序路径、一行常驻说明同一桌面上开着 Web App 的风险、agent-desktop 的安装进度（附「安装」或「重试」）与各系统的前提条件（中英两套措辞）。macOS 上另有「打开系统设置」。musl 或低于 2.35 的 glibc 显示「此平台不支持」。
- `scripts/build-plugins.mjs` 新增 `MARKET_ONLY`：名单上的包照常发布并列入服务端的内置索引，但不进内置前缀。现有一项 `computer-use`。
- 新增按路径触发的工作流 `computer-use-smoke.yml`，在 ubuntu-latest（Xvfb 下的 GTK 窗口）、windows-latest（记事本）与 macos-latest（无需辅助功能授权的命令）上运行插件的安装与命令。
- 新增文档页：指南 › 电脑操作。技能改写自 agent-desktop 附带的指南（Apache-2.0），记录在 `THIRD-PARTY-NOTICES.md`。
