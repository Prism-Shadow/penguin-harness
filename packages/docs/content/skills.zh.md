---
title: 技能与插件
description: 浏览插件，为 Agent 安装 Skill 和钩子包，为 Project 添加服务端插件，在对话中使用 Skill，编写自己的 Skill。
---

**Skill** 是一组可复用的指令，Agent 在任务用得上时才去读取。**钩子包**是一组脚本，由 harness 在 Agent 循环的固定节点运行。**插件**可以包含 Skill、钩子包，或两者都有。全部内置插件组成插件库，列在 Web App 的**插件市场**页面上；同一页面还列出[服务端插件](#服务端插件)，这类插件扩展的是服务器，而不是 Agent。

- **想给 Agent 添加新能力？** 见[浏览插件](#浏览插件)和[在 Agent 上安装插件](#在-agent-上安装插件)。
- **有更新可装？** 见[更新已安装的插件](#更新已安装的插件)。
- **想让 Agent 用上指定的 Skill？** 见[在对话中使用 Skill](#在对话中使用-skill)。
- **要管理某个 Agent 的 Skill 和钩子？** 见[管理 Agent 的 Skill](#管理-agent-的-skill) 和[钩子包](#钩子包)。
- **要添加沙箱后端或其他服务端插件？** 见[服务端插件](#服务端插件)。
- **想自己写 Skill？** 见[编写 Skill](#编写-skill)。
- **想了解文件格式和内部机制？** 见[工作原理](#工作原理)。

## 浏览插件

1. 在侧边栏选择**插件市场**。
2. 浏览列表。**已安装的插件**排在最前，默认折叠，点击标题即可展开。其中先是插件库，然后是当前 Project 要求的服务端插件。**可安装**列出 Project 还可以添加的服务端插件。
3. 要缩小范围，可以在搜索框中输入，或在列表旁的筛选栏中勾选选项：**分类**、**包含**和**状态**。**清除筛选**会清空已选的选项和搜索框。有搜索词或筛选条件时，两个列表都会展开。
4. 点击插件库插件的卡片打开详情。

每张卡片显示插件名称、简短描述，以及一行形如 `v<版本> · N 天前更新 · N 个 Agent 在用` 的信息。其中的 Agent 数量，统计的是当前 Project 里装了这个插件任意部分的 Agent。这一行下方的标签依次标出插件的分类（办公效率、软件开发、AI 应用开发、Agent 公司或其他）、**内置**，以及插件包含的 Skill 和钩子包数量。

详情里有完整描述、插件的钩子包在哪些钩子点运行，以及一个文件浏览器。左侧目录树中，每个 Skill 对应一个文件夹，`SKILL.md` 排在最前，参考文件跟在后面；另有一个**钩子**文件夹存放钩子脚本。右侧预览区显示选中的文件。

卡片右侧的按钮：

| 按钮 | 出现时机 | 作用 |
| --- | --- | --- |
| **管理安装** | 始终显示 | 把插件安装到 Agent 上，或者卸载。 |
| **快捷调用** | 插件至少包含一个 Skill | 打开一个使用该 Skill 的新对话草稿。只有当前 Agent 装了这个插件的某个 Skill 时才可用。 |
| 更新 | 有 Agent 上的安装落后于插件库 | 更新这些安装，见[更新已安装的插件](#更新已安装的插件)。 |

## 在 Agent 上安装插件

1. 在**插件市场**页面，点击插件卡片上的**管理安装**。对话框会列出当前 Project 里的所有 Agent。
2. 在 Agent 旁边点击**安装**。

安装的是整个插件：包括全部 Skill 和钩子包。新对话立即生效；正在运行的对话在下一次压缩后生效。

卸载插件：把鼠标移到 Agent 旁的**已安装**上，点击**卸载**并确认。卸载会删除已安装的 Skill 和钩子文件，包括本地做过的修改。

任何 Project 成员都可以安装、更新和卸载插件。

其他安装方式：

- 创建 Agent 时，在**创建 Agent** 对话框的**插件**字段里选择插件，见[智能体](/agents)。
- 内置 Agent `default_agent` 初始化时会装上整个插件库，标记了 `preinstall: false` 的插件除外。[内置插件库](#内置插件库)的表格注明了哪些插件不预装。
- 插件库之外的 Skill 或钩子包，可以在 Agent 的设置页导入，见[导入 Skill](#导入-skill) 和[导入钩子包](#导入钩子包)。

## 更新已安装的插件

内置插件的新版本随 PenguinHarness 更新一起发布。在你更新之前，Agent 会一直保留已安装的副本。当某个安装落后于插件库时，你会看到：

- 侧边栏**插件市场**上出现红点；
- **插件市场**页面顶部出现「检测到变更：N 个可升级」提示，带**现在升级**和**忽略**按钮；
- 插件卡片上出现更新按钮，**管理安装**里 Agent 旁边出现**更新**按钮。

更新方法：

1. 选择更新范围：
   - 更新所有落后的插件：点击提示里的**现在升级**。
   - 更新某个插件在所有 Agent 上的安装：点击它卡片上的更新按钮。
   - 更新某个插件在某个 Agent 上的安装：在**管理安装**里点击 Agent 旁的**更新**。
2. 确认更新会涉及的范围，然后点击**更新**。

> [!WARNING]
> 更新会用插件库里的副本重装每个 Agent 上已安装的 Skill 和钩子文件，本地修改会全部丢失。需要保留的话，先导出备份，见[管理 Agent 的 Skill](#管理-agent-的-skill)。

**忽略**会隐藏提示和侧边栏红点，直到插件库版本再次变化。卡片上的更新按钮仍然保留。

## 在对话中使用 Skill

Agent 能看到每个已安装 Skill 的名称和描述，任务需要时才读取 Skill 的完整指令。要确保 Agent 使用某个指定 Skill：

1. 在消息输入框点击**技能**，然后选择一个或多个 Skill。也可以输入 `/` 加 Skill 名称来选择。
2. 输入任务内容，发送消息。

选中的 Skill 以标签形式显示在文本上方，发出的消息会显示「使用技能：*name*」。如果只发送 Skill 不带任何文字，消息会变成「使用 *name* 技能」。消息提到某个 Skill 却没有给出任务时，Agent 会先询问你需要什么，再开始执行。

**技能**菜单只列出当前 Agent 上已安装的 Skill，Task 运行期间不可用。

插件卡片上的**快捷调用**一步就能做到同样的事：打开一个新对话草稿，选好 Skill 并填入「使用 *name* 技能」，但不会发送。

## 管理 Agent 的 Skill

要查看某个 Agent 上安装的 Skill，打开**智能体**，选中这个 Agent，然后打开**技能**标签页。

- 每行显示一个 Skill 的名称、简短描述和版本，附两个操作：**打包导出**把 Skill 下载为 zip 文件，**卸载**删除 Skill 目录。
- **启用技能**控制系统提示词中是否列出已安装的 Skill。关闭后，Agent 不知道存在哪些 Skill，但你在对话中选中的 Skill 仍然生效。
- **技能提示词**是系统提示词里介绍 Skill 列表的一段文字。其中的 `{{SKILL_METADATA}}` 占位符会展开为每个已安装 Skill 一行。

**技能**标签页没有更新操作，也不能从插件库添加插件。更新和安装插件请前往**插件市场**页面。

### 导入 Skill

导入插件库之外的 Skill 有两种方式。推荐第一种：Agent 会先读取并审查 Skill，然后再安装。

通过对话导入：

1. 在**技能**标签页点击**导入技能**。
2. 在**技能来源**中填入网页、GitHub 仓库或目录、本地路径，或者其他生态的安装命令，例如 `npx skills add <name>`。
3. 点击**打开新对话**。新对话打开后，Prompt 已经填好。也可以点击**复制 Prompt**，拿到别处使用。
4. 发送消息。Agent 会完整读取来源，检查是否安全，然后安装 Skill。如果安装了 `skill-porting` Skill，Agent 会按它的流程操作。

通过上传 zip 文件导入：

1. 在**技能**标签页点击**导入技能**。
2. 在**上传技能 zip 包**下点击**选择 zip 文件**。zip 包的根目录下必须有 `SKILL.md`，或者有且仅有一个包含 `SKILL.md` 的顶层目录。
3. 如果已安装同名 Skill，点击**覆盖安装**确认。覆盖安装会替换全部文件。

zip 文件最大 14 MB，最多 200 个文件；解压后单个文件不超过 5 MB，总量不超过 20 MB。

## 钩子包

钩子包在 Agent 循环的[钩子点](/agent-loop#stop-hook)运行脚本：你发送消息时、工具调用之前，以及 Task 结束时。比如[目标模式](/goal-mode)就由 `goal` 插件的钩子包驱动。钩子包通常随插件库里的插件一起安装。

要管理某个 Agent 的钩子包，打开**智能体**，选中这个 Agent，然后打开**钩子**标签页。

- **启用钩子**是整个 Agent 的钩子总开关，不能按包单独开关。开启时，这个 Agent 启动的每个 Session 都会运行全部已安装的钩子包；关闭时，新 Session 不运行任何钩子，已安装的包仍然保留。改动从下一轮开始生效，已经在运行的 Task 沿用它开始时的设置。只有 Project owner 能改这个开关。
- 每行显示包的名称、运行的钩子点、描述和版本，附**打包导出**和**卸载**两个操作。

### 导入钩子包

通过对话导入：

1. 在**钩子**标签页点击**导入钩子**。
2. 在**钩子来源**中填入 URL、GitHub 仓库、本地路径、描述你想要的钩子的一段文字，或者其他工具的钩子配置，例如 Claude Code `settings.json` 里的 `hooks` 块。
3. 点击**打开新对话**或**复制 Prompt**。
4. 发送消息。Agent 会读取来源，审查每个脚本，然后把包安装到这个 Agent 上。

通过上传 zip 文件导入：

1. 在**钩子**标签页点击**导入钩子**。
2. 在 **上传钩子包 zip** 下方点击**选择 zip 文件**。zip 包的根目录下，或唯一一个顶层目录里，必须有 `hooks.json` 和脚本文件。`hooks.json` 里的每个命令都必须指向 zip 包内的文件。
3. 如果已安装同名包，点击**覆盖安装**确认。

> [!WARNING]
> 导入的钩子包立即生效。只要 Agent 开着钩子，这些脚本就会在本机的每个钩子点运行，请只导入你信任的包。

## 服务端插件

服务端插件扩展的是服务器本身，而不是 Agent：它是一个由服务端模块组成的 npm 包，例如沙箱后端。每个 Project 声明自己需要的服务端插件，服务器运行任一 Project 要求的全部插件，因此插件提供的能力对所有 Project 都可用。

在**插件市场**页面上，服务端插件的一行显示包名、描述、版本和状态，标签标出它的分类、随 PenguinHarness 发布时的**内置**，以及关键词。点击这一行打开插件页面，查看许可证、作者、链接和说明文档。市场里没有条目的插件没有页面。

为当前 Project 添加服务端插件：

1. 在**可安装**下，点击插件那一行的**安装**。
2. 确认。添加或移除服务端插件会中止所有 Project 中正在进行的 Agent 运行。

移除插件：在**已安装的插件**下点击它那一行的**移除**，然后确认。插件会从 Project 的列表中去掉，磁盘上的文件不会被删除。

只有管理员能看到**安装**和**移除**。只能添加随 PenguinHarness 发布的插件，因此不会下载任何东西。改动无需重启服务器即可生效：服务器围绕新列表重建业务面，所以正在进行的运行会被中止。之后，这一行的状态显示为**运行中**；服务器无法免重启应用改动时显示**待重启**；加载失败时显示**加载失败**并附上原因。

列表就是 Project 配置中的 `[plugins]` 表，见[配置参考](/configuration#插件)。路由见 [Server API](/server-api#插件注册表与-project-插件)，服务器如何加载插件见 [Server 启动与子系统](/server-boot#重组)。

## 编写 Skill

一个 Skill 就是一个目录，位于 Agent 的 `agent_state/skills/` 下，里面有 `SKILL.md` 文件，以及 `SKILL.md` 引用的其他文件。

1. 创建目录 `agent_state/skills/<name>/`。目录名就是 Skill 名称，必须匹配 `^[A-Za-z0-9_-]+$`。
2. 在目录里创建 `SKILL.md`：先写一个包含 `name` 和 `description` 的 frontmatter 块，后面写正文指令。示例如下。
3. 添加 `SKILL.md` 引用的其他文件，比如它链接到的 `reference/` 目录。

```md
---
name: my-skill
description: One-line English description injected into the system prompt.
---

# My Skill

Concrete steps, boundaries and acceptance criteria...
```

下次组装系统提示词时，Agent 就会加载这个 Skill。没有 `SKILL.md` 的目录不算 Skill。由于每次读取都直接访问文件，你也可以就地修改已安装的 Skill。

Skill 自身没有图标。已安装的 Skill 或钩子包显示来源插件的图标。没有插件图标时（比如你自己写的 Skill），Skill 显示书本图标，钩子包显示钩子图标。

### 持续改进 Skill

Agent 可以在 Task 中重写自己的 `SKILL.md`。结合 Benchmark 评估和优化，这就形成了完整的改进闭环；参见[自我进化](/self-improvement)。修改 Skill 时，把 `version` 设为当天的日期加下一个序号。

长 Task 也能把经验沉淀回来。装上 `continual-learning` 插件后，一个 Task 运行超过 30 轮才结束时，插件的 stop 钩子会把这个 Task 的精简摘录交给一个后台子 Agent，由它把有长期价值的发现写进相关的 `SKILL.md` 文件，见 [Agent 循环](/agent-loop#stop-hook)。

## 内置插件库

内置插件按分类列出（`PLUGIN_CATEGORIES` 定义于 `packages/core/src/plugins/index.ts`；插件会陆续增加，以插件库目录为准）：

| 分类 | 插件 | 用途 |
| --- | --- | --- |
| 办公效率 | `data-analysis` | 完成数据分析任务：有限度地检查证据，明确决定是否修改答案，原生处理产出文件，并核验最终输出 |
| | `use-firecrawl` | 通过 Firecrawl API 搜索网页、抓取页面，输出干净的 markdown |
| | `use-bento-slides` | 创建和编辑 Bento 演示文稿：单文件 `.bento.html` 幻灯片，文件内容为 JSON，支持素材到图表的映射、morph 过渡和状态幻灯片 |
| | `humanizer` | 去除任何语言文字中的 AI 写作痕迹，改写成书籍、报纸和百科全书的语体（不预装：需要时从插件库安装） |
| | `goal` | [目标模式](/goal-mode)背后的 stop 钩子：让 Session 持续朝着目标推进，直到完成、受阻或 Token 预算耗尽（预装） |
| | `continual-learning` | Task 运行超过 30 轮才结束时，把 Task 的精简摘录交给后台子 Agent，由它把有长期价值的发现沉淀到 Agent 的 Skill 中（不预装） |
| 软件开发 | `software-development` | 端到端的软件开发，包含两个 Skill：`software-engineering`（在最小范围内调查、实现和验证）和 `web-design`（生成 Web UI 用的 Penguin 视觉语言） |
| | `use-claude-code` | 通过 SSH 在远程主机上运行 Claude Code：持久 expect 会话、带 stdin 修复的无头 `-p` 模式、tmux 驱动的交互式 TUI，以及多轮连续性（不预装：需要时从插件库安装） |
| AI 应用开发 | `agent-development` | PenguinHarness 上的 Agent 开发，包含四个 Skill：`penguin-sdk`（基于 SDK 构建 Agent/AI/RAG 应用）、`unified-llm-api`（通过 `@prismshadow/agenthub` 调用模型 API）、`penguin-config`（管理模型密钥、默认值和 Vault 机密）和 `penguin-orchestration`（在 shell 里驱动 Agent、Session、成本和定时任务） |
| | `model-development` | 在自己的硬件上做模型开发，包含三个 Skill：`llamafactory`（微调）、`ollama`（运行本地模型）和 `vllm`（在 OpenAI 兼容端点后面提供服务） |
| | `skill-porting` | 把外部来源（插件市场、skills.sh 注册表、GitHub 仓库或本地文件夹）的 Skill 经审查和规范化后移植到 Agent |
| | `agent-tuning` | 用四个 Skill 构成调优闭环：`agent-initialization`（根据需求搭建 Agent）、`benchmark-design`（设计和校准能力 Benchmark）、`agent-evaluation`（隔离执行单个题目并打分）和 `agent-optimization`（根据实测结果改进 Agent） |
| Agent 公司 | `agent-company` | [公司模式](/company-mode)的完整工具包，包含七个 Skill：`company-setup`（与用户一起创建组织：一次问一个问题、给出摘要供确认，然后执行 `penguin org create`；从不招聘，也不提交工单）、`company-employee`（每个工位 Session 和工单 Session 都要遵循的协议：触发块、工单看板、阻塞、重负载或不可逆的工作先向董事会请示、频道礼仪、预算）、`company-ceo`（把使命拆解为工单、招聘、划分 Workspace、审查、向董事会汇报）、`company-hr`（日历排班、招聘与离职、评估）、`company-finance`（预算、每日审计、告警与暂停）、`company-research`（科研组织的作者与审稿人：先固定评测脚本与指标，在董事会批准的资源额度内跑实验循环、只保留能提升指标的改动，每个结论都交给一个设法推翻它的审稿人）和 `company-mirror`（数字分身公司：每位真实同事对应一个分身，绑定到这位同事的机器人，只传话、不开工单）。不预装：组织在创建 CEO、招聘员工时会安装它；需要能创建组织的 Agent 则从插件库安装 |

## 工作原理

本节介绍上文各项操作背后的文件格式、命名和版本规则，以及加载与安装机制。

### 插件文件格式

插件是一个目录，包含一份 `plugin.json` 清单和插件发布的内容：

```text
plugins/<plugin>/
├── plugin.json                # manifest — the plugin's single metadata holder
├── icon.svg                   # the plugin's icon (every built-in plugin ships one)
├── skills/<name>/SKILL.md     # zero or more skills (reference/… alongside)
└── hooks/*.mjs                # at most one hook package: plain Node scripts
```

`plugin.json` 字段：

| 字段 | 含义 |
| --- | --- |
| `description` / `description_zh` | 一行描述（英文必填） |
| `short_description` / `short_description_zh` | 卡片上显示的简短文案（可选；不填则使用完整描述） |
| `version` | `YYYY.MM.DD.N`：日期加当天的序号 |
| `category` | `office-productivity`、`software-development`、`ai-app-development`、`agent-company` 之一；缺失或未知的分类归入「其他」 |
| `preinstall` | 可选；设为 `false` 的插件不进入 `default_agent` 的预装集合，只能从插件库手动安装 |
| `hooks.stop` / `hooks.pre_tool_use` / `hooks.user_prompt` | 钩子包在各个[钩子点](/agent-loop#stop-hook)运行的命令：`[{ "command": "stop.mjs", "timeout": 60 }]`，路径以 `hooks/` 为起点，timeout 单位为秒 |

### 插件命名与版本

- 插件名就是目录名，必须匹配 `^[A-Za-z0-9_-]+$`。
- 围绕他人产品打造的插件带 `use-` 前缀（如 `use-firecrawl`），名称只表明用途，而不冒充产品本身。
- 版本先按日期比较，再按序号比较：`2026.08.29.10` 排在 `2026.08.29.9` 之后。
- 清单里的 `version` 是插件所含全部内容的版本，与 npm 包版本相互独立；npm 版本跟随产品发布。除此之外没有其他版本方案。
- 每个插件都是一个独立的 npm 包 `@penguinharness/<name>`，位于仓库的 `plugins/<name>/`。`@prismshadow/penguin-core` 中的加载器从宿主包的依赖列表读取插件名，并通过 Node 解析各个包。桌面应用把同样的包声明为依赖，安装器会将它们打包。运行时，插件文件就是插件库内容的唯一事实来源，每次调用都直接读取。

### Skill 文件格式

Skill 的目录名是权威名称，必须匹配 `^[A-Za-z0-9_-]+$`，并覆盖 frontmatter 中的任何 `name`。

插件库中的 `SKILL.md` 只有两个 frontmatter 字段，其余信息都在 `plugin.json` 里。

| 字段 | 含义 |
| --- | --- |
| `name` | Skill 名称，与目录名一致 |
| `description` | 注入系统提示词的英文单行描述 |

已安装的副本自带描述。加载时，插件库会重新生成每个 Skill 的 frontmatter，加上插件的 `short_description`、`short_description_zh` 和 `version`，然后写入 `agent_state/skills/`，做法与已安装钩子包的 `hooks.json` 由清单生成时一致。更新检查读取安装副本 frontmatter 里的 `version`，Web App 则读取其中的简短描述。

解析很宽容：只有第一个 `---` 块里的 `key: value` 标量行才算数。`version` 既不是 `YYYY.MM.DD.N`、也不是旧版安装副本使用的 `YYYY-MM-DD.N` 时，就按空值处理。空版本比任何插件库版本都旧，所以插件库里的副本算作可用的更新。

### 钩子包清单

安装后的钩子包就是插件的 `hooks/` 目录，安装为 `agent_state/hooks/<plugin>/`，脚本旁边附带一份生成的 `hooks.json`。清单保存插件的标识字段（`name`、`description`、`description_zh`、`version`），以及每个钩子点各自的命令列表：

```json
{
  "name": "goal",
  "description": "Goal mode: …",
  "description_zh": "目标模式：…",
  "version": "2026.09.01.1",
  "stop": [{ "command": "stop.mjs", "timeout": 60 }],
  "pre_tool_use": [],
  "user_prompt": [{ "command": "start.mjs", "timeout": 60 }]
}
```

脚本是只用内置模块的纯 Node 代码，harness 能运行的地方它们就能运行。每个脚本以子进程方式运行：从 stdin 读取 JSON，向 stdout 写回 JSON 应答；[Agent 循环](/agent-loop#stop-hook)描述了这套约定。Agent 的每个顶层 Session 都会在循环的各个钩子点查询已安装的钩子包。**启用钩子**开关保存在 Agent 的 `system_config.yaml` 的 `hooks.enabled` 键里；这个键不存在时，钩子处于开启状态。

钩子包的其他脚本供宿主按约定调用。例如，用户发起目标时，服务端运行的就是 `goal` 插件的 `start.mjs`；参见[目标模式](/goal-mode)。

### 渐进加载

Skill 分两步加载：先加载索引，正文按需读取。

- 系统提示词里的 `{{SKILLS}}` 占位符展开为**技能提示词**，其中的 `{{SKILL_METADATA}}` 占位符列出每个已安装 Skill 的名称和描述。**启用技能**关闭、或模板中没有 `{{SKILLS}}` 占位符时，什么都不注入。
- 提示词要求模型先完整读取对应的 `SKILL.md`，再遵循 Skill。这里没有专门的 Skill 工具：读正文就是一次 `read_file` 或 shell 调用；参见[工具与审批](/tools)。
- 在对话中选中 Skill 后，消息会以 `[use_skills]` 块开头，列出这些 Skill 的名称。显示旧 Trace 时，仍然识别早期的 `<use_skills>` 写法。

### 安装与存储

已安装的 Skill 存放在 `agent_state/skills/<name>/` 下，钩子包存放在 `agent_state/hooks/<name>/` 下。文件就是唯一事实来源：每次读取都直接访问磁盘，没有缓存。

- 安装 Skill 时，会写入可安装版的 `SKILL.md`（含重新生成的 frontmatter）、插件的 `icon.svg`，以及 Skill 目录里的其他文件，子目录结构保持不变。自己编写或导入的 Skill 可以自带 `icon.svg`，这时复制的是 Skill 自带的图标。
- 安装钩子包时，会写入 `hooks.json`、插件的 `icon.svg`，以及插件 `hooks/` 目录下的所有文件。
- 每次安装都会整体替换目录，所以重新安装会清掉新版本不再包含的文件。已安装的副本就是靠重新安装来更新的。
- 卸载会删除整个 `skills/<name>/` 或 `hooks/<name>/` 目录。
- 运行中的 Session 沿用创建时加载的钩子包。安装或卸载钩子包、或者**启用钩子**开关变动之后，服务端会在 Agent 缓存的运行时下次空闲时重建它们。
- 除 Web App 外，插件也可以通过 SDK 安装。
