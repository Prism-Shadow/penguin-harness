# Agent 的定义可发布为 GitHub gist（以服务器 gh 的登录身份），并可从 gist、npm、GitHub、git 或链接安装

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `server`, `web`

[English](2026-08-30-agent-packages.md)

Agent 现在可以作为*包*分享：它的定义——`agent_state/`（系统配置、提示词、技能、工具）和 `workflows/`（它为自己写的代码与页面）——以一组可读文本文件的形式发布到 GitHub gist，并可在任何一台 harness 上从这样的 gist 安装为一个新 Agent。Agent "经历过的东西"留在原地：记忆、工作区、scratchpad、评测结果、工作流的 `state.json`、版本历史和密钥库都不会被打包，所以装出来的是同一个 Agent，但什么都还没经历。

## 格式

gist 没有目录——它的 API 直接拒绝含 `/` 的文件名——因此路径用反斜杠压平成文件名（`agent_state/skills/x/SKILL.md` → `agent_state\skills\x\SKILL.md`），GitHub 接受并原样保存，由 `penguin-agent.json` 携带清单（格式 `1`、Agent 的 id / 名称 / 描述、打包它的 harness 版本、每个文件的路径与编码）。文本原样存放，gist 页面上可读可 diff；二进制文件用 base64。一个包上限 5 MB；含反斜杠的文件名无法打包（无法往返还原）。用早先 `--` 分隔符发布的包仍然可读。

安装前逐项校验，任何字节都不会提前写入：清单格式、每条路径必须是相对路径、不能越界、必须落在可打包前缀之下、文件名必须与路径一致、GitHub 未截断文件。Agent 先按正常生命周期创建，文件随后写入；失败则删掉半成品。

## 路由

`GET /api/projects/:p/agents/:a/package` 展示将要发布的内容（清单、大小、服务器是否能发布）。`POST …/package/publish { gistId?, public? }`（owner）发布。**一个 Agent 只对应一个 gist**：它发布到的 gist 记录在自己身边（Agent 目录下的 `.penguin-publish.json`，是 dotfile，因此永远不会被打包），重新发布时调用方什么都不用传就会更新那个 gist。`gistId` 可覆盖目标；只有首次发布才会新建。更新时还会*删除*包里已经没有的文件——gist 更新本身只做新增与覆盖，否则改名或删掉的文件会永远留在 gist 里。内容没有变化的重新发布不消耗任何 API 调用：已发布内容的摘要与 gist 一起记录，若这次要写的正是它，直接返回 `unchanged: true` 而不请求 GitHub（显式指定 `gistId` 则一定写入，gist 在 GitHub 上被删或被手改时用它覆盖）。gist 的描述——也就是 GitHub 列表里显示的标题——为 `<名称> — <Agent 自己的描述> · PenguinHarness Agent`。若记住的 gist 已在 GitHub 上被删除，下一次发布会新建一个，而不是失败。`POST /api/agent-packages/preview { gist }` 读取并校验 gist、不写任何东西；`POST /api/agent-packages/install { gist, projectId, agentId }`（owner）安装。gist 可用链接或裸 id 指定。

## 其他来源

安装不只读 gist。来源可以是：gist 链接或 id；`npm:<包名>[@版本]`（取 registry 的 tarball）；GitHub 仓库——`https://github.com/o/r`、`…/tree/<ref>` 或 `github:o/r[#ref]`——取该 ref 的 tarball，未给出时为默认分支；GitHub release——`…/releases/latest`、`…/releases/tag/<tag>` 或 `github-release:o/r[#tag]`——有 `.tgz`/`.tar.gz` 资产则取之，否则取源码 tarball；git 地址（`git+…`、`git@…`、`ssh://`、以 `.git` 结尾，`#ref` 指定分支或标签）做浅克隆，需要服务器上有 `git`；以及任何其他 http(s) 链接，按 tarball 处理。类型按形状识别，也可用 `kind` 强制。tarball 惯有的单层顶级目录（`package/`、`owner-repo-sha/`）会被剥掉。

目录形态的来源不需要清单：其中属于 Agent 定义的部分——`agent_state/`、`workflows/`，排除项同前——就是包，因此一个本身就是 Agent 目录的仓库可以原样安装。若带有 `penguin-agent.json`，则每一项都必须存在（按路径或压平名），并通过与 gist 相同的检查。文件树上限 2000 个文件。

## 身份

发布有两种认证方式，优先第一种：**服务器所在机器上已登录的 `gh` CLI**，或存在 harness 里的 GitHub token。gh 的凭据不会从它自己的存储里被读出来——服务器把请求交给 gh（`gh api`，请求体走 stdin），由 gh 自己带上认证，因此没有任何东西被复制进 harness，`gh auth logout` 即可吊销。兜底 token（`gist` 权限）是服务器设置 `github_token`：与消息通道凭据、代理地址一样明文落盘，且在所有 API 表面只写不读——`GET /api/admin/settings` 返回 `githubTokenSet`，`PUT` 接受 `githubToken`（空串即清除）。读取公开 gist 两者都不需要，什么都没配也能安装；没有 token 时，私有 gist 通过 gh 读取。

## Web App

设置新增 **分享** 页（管理员）用于配置兜底 token；发布对话框会说明将使用哪种身份，以及（该 Agent 发布过之后）将要更新的那个 gist。Agent 概览页在快照导出 / 导入旁多了 **发布到 gist**：对话框列出将要发送的内容与不包含的内容，提供上次发布的 gist（按 Agent 记忆）以便就地更新，并展示结果链接。Agent 列表页多了 **安装 Agent**：粘贴任意来源（类型自动识别，也可用下拉强制），读取（名称、描述、解析后的来源、文件数、大小、打包版本），选择新 Agent 的 id——清单里的，或来源的名字——然后安装。
