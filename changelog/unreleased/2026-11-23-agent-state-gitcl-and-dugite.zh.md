# 工作台版本优先由本机 git 记录

- **Date:** 2026-11-23
- **Type:** change
- **Scope:** `server`, `plugins`, `docs`

[English](2026-11-23-agent-state-gitcl-and-dugite.md)

以原生 Git 记录 Agent State 版本的服务端模块插件一分为二，主机上有 git 的那一种不再下载任何东西：

- `@penguinharness/agent-state-gitcl`（新增）运行本机已有的 git 命令行——`PATH` 上的 `git`，探测一次、进程内记住答案——用脚本都在用的那几条标准 git 命令、每条命令一个进程，承担与原先插件用下载构建运行的两个步骤：写一次提交，读回一个版本的文件。不下载、不留存；本机 git 自行定位它的 exec path，插件不为它设置 `GIT_EXEC_PATH`。`PATH` 上没有 `git` 或它跑不起来的主机就是没有。
- `@penguinharness/agent-state-dugite`（由 `agent-state-git` 改名）其余不变：它在主机首次运行时下载 dugite 固定的 GitHub Desktop Git 构建，服务 gitcl 插件覆盖不了的主机——`PATH` 上没有 `git`、程序起不来、或那不是 Git。

## 哪个引擎运行

由谁记录版本是 harness 自己的决定，不是贡献者的：内置侧优先 harness 自家插件的引擎——gitcl 引擎先跑、dugite 引擎是没有 git 的主机上的后备，其他插件贡献的引擎排在其后、按贡献顺序。两者都没有的主机照旧用内置引擎。它们写出的提交相同，仓库不会察觉是谁写的。

## 细节

- gitcl 引擎声明与 dugite 引擎相同的 `fasterFrom` 步长，后者由它的基准（`bench/engines.bench-run.ts`）测得。
- gitcl 插件不带二进制，测试期也不下载；它的实跑套件在有可用 `git` 的主机上运行、其余跳过，与其他插件套件用同一道闸（`PENGUIN_MUST_RUN`）。
- 两个插件都在插件页上，没有分类；由管理员安装到服务端。「技能与插件」文档同时描述两者。
