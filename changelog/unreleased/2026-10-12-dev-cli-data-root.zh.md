# 检出里的 `penguin` 不再连到已安装版本的数据根目录

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1056](https://github.com/Prism-Shadow/penguin-harness/pull/1056)

[English](2026-10-12-dev-cli-data-root.md)

`pnpm build` 会把检出的 CLI 链接到全局，而这个 `penguin` 运行时没有 `pnpm penguin` 设置的 `PENGUIN_HOME`，于是用的是已安装版本的数据根目录 `~/.penguin/data`。在那里读取 Project 配置的命令（例如 `penguin config model list`）会把配置文件迁移为 MMSP 的客户端类型名称，此后已安装的版本每个 Session 都会失败（`400 … deepseek-official is not supported`）。现在从检出运行的代码默认使用 dev CLI 的数据根目录；有其他服务器持有数据根目录时，迁移结果也不再写回文件。

## 细节

- 未设置 `PENGUIN_HOME` 时，从源码检出运行的代码默认使用 `~/.penguin/dev-data-cli`，即 `pnpm penguin` 的数据根目录。全局链接的 `penguin`、它启动的服务器，以及在开发脚本之外从检出启动的其他程序都在此列。core 在运行时按自身的加载位置判断：其上层某个目录含有 `pnpm-workspace.yaml` 与本仓库的 `packages/core`，即为检出。安装版保持使用 `~/.penguin/data`：安装脚本装的 CLI、桌面应用，以及从 npm 安装的 SDK（装在别的 pnpm workspace 里也一样）。`pnpm dev` 与 `pnpm desktop` 仍然设置 `~/.penguin/dev-data`，已设置的 `PENGUIN_HOME` 仍然优先。
- 另一个仍在运行的进程持有数据根目录的 `server.lock` 时，该目录下 `.project_config.toml` 的一次性迁移只在内存中生效，文件保持原样：那台服务器可能是读不懂新客户端类型的旧版本，而当前版本的服务器会在自己读取时完成迁移。该文件的两个读取方都这样处理：core 的 `loadProjectConfig`（CLI 与 SDK 使用）与服务器自己的读取。

## 兼容性

链接的 `penguin` 原先在 `~/.penguin/data` 上工作的贡献者，从它那里不再看到那份数据，数据本身原样保留。要从检出访问它，按命令显式指定：`PENGUIN_HOME=~/.penguin/data penguin …`。安装版的各个入口不受影响。
