# 工作台版本记下作者，并可改由原生 Git 记录

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `core`, `plugins`, `docs`
- **PR:** [#1608](https://github.com/Prism-Shadow/penguin-harness/pull/1608)

[English](2026-11-19-agent-state-git-plugin.md)

工作台版本在 `agent_state.git/` 中的提交记下作者：记录它的请求所属的成员，否则为服务端的 Git 身份。新增服务端插件 `agent-state-git`，改由原生 Git 写入这些提交并读回版本，代替内置的 isomorphic-git 引擎；内置引擎仍是默认。

## 版本的作者

- 由成员的请求（恢复、重载、zip 导入、开关、应用中心开关、移除）记录的版本，作者名取该成员的显示名。没有显示名的成员，以及账号没有的字段（账号没有邮箱），取服务端自己的身份。
- 服务端的身份按 git 的读法逐字段取：`GIT_AUTHOR_*` / `GIT_COMMITTER_*`，然后是仓库 `config` 叠在全局文件（`$GIT_CONFIG_GLOBAL`，否则 `$XDG_CONFIG_HOME/git/config` 与 `~/.gitconfig`）之上的 `author.*` / `committer.*`，再是 `user.*`，邮箱另看 `EMAIL`，都没有时为 `PenguinHarness <penguin@localhost>`。只读 `[user]`、`[author]`、`[committer]` 三节，不跟随 `include`，不写任何配置。
- Agent 自己编辑后记录的版本用服务端的身份。提交者始终是服务端。

## 引擎槽

- 服务端模块树新增 `AgentStateHistoryModule` 及其 `engines` 槽，core 的插件契约新增 `AgentStateEngine` 等类型。引擎写一次提交、读回 blob；读 HEAD 与树、判断有无改动、回溯历史与删除留在服务端。
- 引擎的来源给出引擎后即被采用，且只承担它声明更快的应用规模（`fasterFrom`）起的步骤。起不来的引擎在该步由内置引擎接替并记一条日志；git 拒绝写入则如实报错。两种引擎写出相同的提交。

## agent-state-git 插件

- `@penguinharness/agent-state-git` 运行 dugite 3.3.3 固定的 GitHub Desktop Git 构建（Git 2.56.1）。它在一台主机上首次运行时下载本平台的归档（24–65 MiB），校验 sha256，只把 `git`（Windows 另有它加载的 DLL）共 3.4–7.1 MiB 留在 `<数据根>/cache/agent-state-git.engine/`。`LOCAL_GIT_DIRECTORY` 与 `DUGITE_CACHE_DIR` 的用法与 dugite 相同。构建与安装都不下载任何东西：工作区不运行 dugite 的 postinstall。
- 它在 Linux 上从 1 个文件起、macOS 上从 30 个、Windows 上从 300 个起承担提交，恢复分别从 150、100、150 个文件起，即其基准测得比内置引擎快的规模；更小的步骤仍走内置引擎。
- 一次提交是一次 `git fast-import`，一次恢复是一次 `git cat-file --batch`。每个进程只定位该 Agent 的仓库，剥除全部 `GIT_*` 变量，不读系统与全局配置，不运行钩子，不签名，并同步对象与引用。
- 没有对应构建的主机（musl、其他架构）、下载失败或程序无法运行时，由内置引擎记录版本，日志说明原因。
- 插件出现在插件页，没有分类；由管理员安装到服务端。
- 插件以自己的引擎运行服务端的 Agent State 测试套件，并检查每一步写出的对象与内置引擎相同。`pnpm --filter @penguinharness/agent-state-git bench` 逐步比较两种引擎。
- 文档「技能与插件」一页说明了版本的作者与该插件。
