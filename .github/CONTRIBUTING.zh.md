# 参与 PenguinHarness 开发

[English](CONTRIBUTING.md)

感谢你参与建设 PenguinHarness！本指南涵盖工作区搭建、日常命令、质量门禁，以及仓库的工作规则。

参与本项目受 [行为准则](CODE_OF_CONDUCT.zh.md) 约束。安全问题不要开公开 issue——
[安全策略](SECURITY.zh.md) 说明了应该发往何处。

## 前置条件

- Node >= 24
- pnpm 11（`corepack enable` 或 `npm install -g pnpm`）

## 搭建与日常命令

```bash
pnpm install
pnpm build       # 先构建：core 的导出指向 dist/

pnpm dev         # 服务端 + Web 一起启动（带前缀日志，依赖只构建一次）
pnpm dev:server  # 服务端，127.0.0.1:7368（不是已安装 server 的 7364）
pnpm dev:web     # Web App（Vite），127.0.0.1:7365，/api 代理到 7368
pnpm dev:docs    # 文档站（Vite），127.0.0.1:7367
pnpm dev:landing # 落地页（Vite），127.0.0.1:7366
pnpm penguin ... # 从源码运行 CLI；`penguin web` 服务在 127.0.0.1:7369
pnpm desktop     # 从源码运行桌面应用（先全量构建，再启动 Electron）

BASE_PATH=/ pnpm build:site   # 完全按 Pages 部署的方式组装落地页 + 文档
```

每条 dev 命令都会先执行 `scripts/dev-prebuild.mjs`。它在一把用于串行化并发调用的锁之后，
**自动保持 `pnpm install` 处于最新状态**——全新 clone 或拉到的 lockfile 变更会在启动前先安装，
而已经最新的工作树不付出任何代价（lockfile 的哈希会被打戳记录）——随后预构建工作区依赖
（skills、core），并对背靠背的构建去重：同时启动 `dev:server` 与 `dev:web`（或直接 `pnpm dev`），
安装与构建各只发生一次。当这次构建改变了 skills/core 的产物时，预处理步骤还会清掉 Web App 的
Vite 依赖缓存（`packages/web/node_modules/.vite`）——该缓存仅以 lockfile/配置为键，否则会继续把
上一版 core 喂给浏览器。`dev:docs` / `dev:landing` 只跑安装检查（`--install-only`）。

绕开 dev 命令时有一条规则：**通过 pnpm 重新构建 skills/core，并按此顺序**（`pnpm build`，或重启
`pnpm dev`）——工作区使用注入式依赖（pnpm-workspace.yaml 中的 `injectWorkspacePackages`），因此
web/server 消费的是快照副本，只有当该包的 `build` 脚本经由 pnpm 运行时才会重新同步
（`syncInjectedDepsAfterScripts`）。在 packages/core 里直接跑 `npx tsup` 会更新
`packages/core/dist`，却把那些快照——以及任何已经填充的 Vite 依赖缓存——留在旧构建上；如果手工重建
之后，正在运行的开发 Web App 仍在提供陈旧的 core，删掉 `packages/web/node_modules/.vite` 再重启。

会触及数据的开发入口默认使用各自独立的数据根目录，与已安装 CLI/server 的 `~/.penguin/data`
分开——在仓库上折腾永远不会把状态与你真实的 Agent 混在一起。`pnpm dev`、`pnpm dev:server` 与
`pnpm desktop` 共用 `~/.penguin/dev-data`；`pnpm penguin` 独占 `~/.penguin/dev-data-cli`，因为一个
数据根目录同时只接纳一个 server（`<root>/server.lock`），而开发版 CLI 的 `penguin web` 恰恰就是那个
随后会让 Agent 去执行 `pnpm dev` 的 harness——共用根目录时，那个 Agent 的 `dev:server` 会被 harness
自己的锁挡住而拒绝启动（正是这种共存关系也已经为它分配了 7369 端口，见
`packages/core/src/internal/ports.ts`）。若仍要让某条开发 CLI 命令对准 `pnpm dev` 的数据集，就为该条
命令单独声明——`PENGUIN_HOME=~/.penguin/dev-data pnpm penguin ...`，或在支持的子命令上使用
`--root`。需要另一个根目录？只为需要它的那一条命令内联传入 `PENGUIN_HOME`
（`PENGUIN_HOME=~/.penguin/dev-data-<topic> pnpm dev`）——绝不要把它 export 进 shell：上述默认值仅在
该变量未设置或为空时才生效（`scripts/run-with-env.mjs`），因此一个已导出的值会静默盖过全部默认值；
而导出 `PENGUIN_HOME=~/.penguin/data` 会把 `pnpm dev:server` 放到发行版/CLI 的根目录上，那里已经有
一个运行中的桌面应用持有锁。桌面开发外壳还多隔离一层：未打包的运行会取一个带 dev 后缀的应用标识
（`PenguinHarness-Dev`），拥有自己的 userData 目录、单实例锁与固定端口，并且即使在没有该环境变量的
情况下启动（`pnpm --dir packages/desktop start`）也默认使用 `~/.penguin/dev-data`——因此它可以与已
安装的发行版并排运行，两个实例互不可见。每次未打包启动都会打印它选中的这一对：
`[shell] dev instance '<name>' on data root <root>`。

这次拆分带来了两处一次性变化。此前直接执行 `pnpm --dir packages/desktop start` 跑在
`~/.penguin/data`（发行版/CLI 根目录）上，现在跑在 `~/.penguin/dev-data`，因此那样创建的会话不再出现
在窗口里——若要刻意对着发行版根目录工作，用 `PENGUIN_HOME=~/.penguin/data` 启动。另外开发外壳的
userData 目录随其名称一并搬家，Chromium 配置文件也跟着走，因此窗口按 origin 存储的偏好（主题、语言、
布局）与记住的端口会重置一次。注意该标识是一个固定名称，而非每个工作副本一个：两份工作副本同时运行
桌面外壳仍会共用它，第二次启动会聚焦到第一个窗口而不是自己开一个——换一个 `PENGUIN_HOME` 也改变不了
这一点，因为它移动的是数据根目录，不是标识。

开发环境下的模型凭据：把 `.env.example` 复制为 `.env`。

## 仓库结构

一个 pnpm monorepo（TypeScript，Node >= 24）。一次安装交付四个层次，它们共享同一个数据目录
（`~/.penguin/data`）与同一套消息协议（OmniMessage）：

| 包                                        | 名称                          | 职责                                                                        |
| ----------------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| [`packages/core`](../packages/core)       | `@prismshadow/penguin-core`   | SDK 与引擎：ReAct 循环、OmniMessage 协议、LLM/Environment 接口契约、Agent State、Trace |
| [`packages/cli`](../packages/cli)         | `@prismshadow/penguin-cli`    | `penguin` 命令：REPL、单次运行、模型与 vault 配置、服务启动器               |
| [`packages/server`](../packages/server)   | `@prismshadow/penguin-server` | Web 后端：HTTP API + SSE 流式传输、多用户认证、Project 鉴权、用量统计       |
| [`packages/web`](../packages/web)         | `@prismshadow/penguin-web`    | Web App：多会话聊天，Agent/Skill/模型管理，Trace 可观测性，评测中心         |
| [`plugins/*`](../plugins) | `@penguinharness/<name>` | 内置插件，一插件一 npm 包：Skill（软件开发、模型开发、Agent 开发/调优……）与会话钩子（目标模式、技能沉淀）；loader 在 `packages/core` |
| [`packages/landing`](../packages/landing) | —                             | 产品落地页（本仓库的官网）                                                 |
| [`packages/docs`](../packages/docs)       | —                             | 文档站（双语，部署在 `/docs/` 下）                                          |

职责按事实来源划分：**SDK** 拥有协议与执行（消息解析、Agent 循环、工具），**Server** 拥有多用户运行时
（认证、SSE 流式传输、定时任务），而 `~/.penguin/data` 下的**文件层**拥有一切可编辑与被记录的东西
（Prompt、Skill、密钥、Trace）。完整对照见
[架构 → 职责划分](https://penguin.ooo/docs/architecture)。

## 质量门禁

以下每一项 CI 都会在每个 PR 上运行——推送前请先在本地跑一遍：

```bash
pnpm format:check   # prettier
pnpm typecheck
pnpm test           # 每个包的单元测试
```

用编码 Agent 在本仓库上开发：[`.agents/skills/penguin-harness-dev/`](../.agents/skills/penguin-harness-dev/SKILL.md)
收集了那些从外部看最容易搞错的约定——双仓库软链接布局、CI 同链路验证、record-and-ship 契约、模型目录的
定价规则，以及那些有意为之的接缝。`.claude` 是指向 `.agents` 的软链接，因此 Claude Code 会话与其他任何
Agent 读到的是同一个目录。

端到端测试（本地可选，较慢）：

```bash
npx playwright install chromium                      # 一次即可
pnpm --filter @prismshadow/penguin-web test:e2e      # 针对 mock LLM 的浏览器 e2e
pnpm test:e2e                                        # core 的真实模型 e2e，需要 DEEPSEEK_API_KEY
```

## 工作规则

- **英文是本仓库的工作语言**——代码、注释、错误与日志信息、测试名与 fixture、包元数据，以及面向开发者
  的文档。中文只出现在它本身就是内容的地方：zh 的 i18n 词条与字段（`strings.ts` 词典、CLI 的
  `i18n.ts`、`titleZh`、`short_description_zh`）、`*.zh.md` 文档，以及断言 zh i18n 输出或验证 CJK
  特有行为的测试字面量。
- **每次改动都随附一条 changelog 条目，中英各一份**：新增
  `changelog/unreleased/YYYY-MM-DD-<semantic-id>.md` 及其 `.zh.md` 对应文件（已发布版本的目录已冻结）
  ——一个 H1 标题、`Date` / `Type` / `Scope` / `PR` / `Issue` / `Breaking` 元数据块、对应文件的链接，
  然后是引导段与按内容命名的小节。没有索引文件需要更新。格式见
  [`changelog/README.zh.md`](../changelog/README.zh.md)。相关联的改动可以共用一个条目文件（扩展它的
  小节），不必为每个小改动都新开一个文件。
- **每次发布随附自己的公告**：`changelog/<version>/RELEASE.md` 会被原样发布为 GitHub Release 正文。
  在发布准备期间撰写，并**在打 tag 之前提交**——发布工作流是从 tag 的 checkout 里读它的，事后添加的
  文件永远到不了 Release 页面。缺少它时，工作流退回到 GitHub 自动生成的说明。
- **发布准备要提升仓库版本号**：那个把 `changelog/unreleased/` 改名的 `release: X.Y.Z` PR，同时也要把
  根目录及每个 `packages/*/package.json` 的 `version`、以及 core 的 `VERSION` 常量
  （`packages/core/src/index.ts`）提升到发布版本。发布工作流会拒绝版本号与仓库不一致的 tag 推送，
  因此漏掉提升会在发布任何东西之前就失败（v0.2.1 曾在仓库还是 0.2.0 时被打了 tag，此后每个开发构建
  都在提示有更新，直到仓库追上为止）。
- `assets/readme/` 下的 README 素材是生成物——基准测试图表由落地页的基准数据生成，演示截图由
  `node packages/landing/scripts/capture-readme-demo.mjs` 生成（需先构建；需要 Playwright chromium）。
  请重新生成，而不要手工编辑。

## 报告缺陷或提出功能建议

从 [issue 表单](https://github.com/Prism-Shadow/penguin-harness/issues/new/choose) 提交。一份缺陷报告
附上版本（`penguin version`）、PenguinHarness 的安装方式、操作系统，以及问题是否在全新的数据根目录上
依然出现（`PENGUIN_HOME=/tmp/penguin-check penguin ...`），价值会高得多——最后这一条能把代码缺陷与
旧版本遗留的状态区分开。永远不要把 API Key、机器人 Token、`system_config.yaml` 或 `.env` 贴进
issue：数据根目录以明文保存 Provider 凭据，而 issue 是公开且永久的。

提问与使用求助请去 [Discord](https://discord.gg/eFHKqqcU3D) 或微信群，不要发到 issue 区。

## Pull Request

- 从 `main` 拉分支；一个 PR 只聚焦一个主题。
- 确保 CI 全绿（build、format、typecheck、test），并在 PR 正文中描述对用户可见的变化。
- 新增的用户可见行为应当带上测试；当它改变了已被文档记录的行为时（README、文档站），还要更新文档。
- 标题与正文用英文撰写，并在 `## Verification` 小节下列出你实际运行过的内容。开 PR 时
  [Pull Request 模板](PULL_REQUEST_TEMPLATE.md) 会自动填入。
- PR 采用 squash 合并，一个 PR 在 `main` 上落成一次提交。合并需要一位审阅者批准，并且所有评审
  讨论串都已解决。
