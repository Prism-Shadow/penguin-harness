---
title: 核心概念
description: PenguinHarness 使用的术语，按主题分组，每条都附有深入讲解它的页面链接。
---

PenguinHarness 用到一组含义明确的术语。本页按主题分组给出定义，每条定义都链接到详细讲解它的页面。

- [工作如何组织](#工作如何组织)：Project、Agent、Agent State、Workspace、数据目录
- [工作如何运行](#工作如何运行)：Session、Task、Trace、OmniMessage、审批模式、子 Agent
- [Agent 可用的能力](#agent-可用的能力)：工具、Skill、插件、钩子包、MCP Server、记忆、Vault、定时任务
- [Agent 如何进化](#agent-如何进化)：Benchmark、题目、评估、优化、版本、快照
- [模型与 Token](#模型与-token)：供应商、模型、思考等级、Token
- [公司模式](#公司模式)：组织、员工、工位会话、工单、频道

## 工作如何组织

### Project

Project 是组织 Agent 的顶层单位，保存其下 Agent 共用的模型表与凭据，以及属于它的 Benchmark。每个用户都自带一个初始 Project，还可以创建更多；一个 Project 也可以由多个用户共同使用。

见 [Web App](/web-app)。

### Agent

Agent 是执行你所交代目标的主体。每个 Agent 都有自己的 Agent State，可以多次运行，每次运行都使用一个 Workspace。Agent 不绑定模型：模型在启动 Session 时由你选择。

见 [Agent](/agents)。

### Agent State

Agent State 是 Agent 的持久化目录 `agent_state/`，存放 Agent 的配置（`system_config.yaml`）、可编辑的提示词文件 `AGENTS.md`、工具与 MCP Server 设置、Skill、钩子包、记忆、Vault 和定时任务。Agent 的行为完全由这些文件决定：你可以通过编辑文件改变它，其他 Agent 也可以。

见[配置参考](/configuration)。

### Workspace

Workspace 是 Agent 在一个 Session 中工作的目录，它读取、创建和修改的文件都在这里。启动 Session 时由你选择 Workspace；如果不选，PenguinHarness 会在 Agent 的目录下创建一个临时 Workspace。

见 [Session 与 Trace](/sessions-and-traces#运行模型)。

### 数据目录

数据目录是 PenguinHarness 存放 Project、Agent、模型设置和 Trace 的地方，默认为 `~/.penguin/data`（Windows 为 `%USERPROFILE%\.penguin\data`）。同一台机器上的桌面应用、CLI 和 SDK 都使用它。要改用其他目录，设置 `PENGUIN_HOME` 即可。

见[快速开始](/quickstart)。

## 工作如何运行

### Session

Session 是你与一个 Agent 在一个 Workspace 里的一段连续对话。一个 Session 里可以发送多条 Prompt，每条 Prompt 发起一个 Task。模型和 Workspace 在创建 Session 时就已确定。在 Web App 里，一个 Session 就是一个对话。

见[对话](/chat)。

### Task

Task 是一条 Prompt 发起的工作。Agent 会调用模型一次或多次（每次调用是一个请求），并在调用之间执行工具。模型不再调用工具、直接给出回复时，Task 结束；运行中途中止时，Task 也会结束，比如你手动停止了它。

见 [Agent 运行循环](/agent-loop)。

### Trace

Trace 是一个 Session 的记录：每条消息、每次工具调用、每个审批决定和 Token 用量，都按顺序追加写入 JSON Lines 文件。PenguinHarness 依据 Trace 恢复 Session，用量与成本的数据也来自这些记录。

见 [Session 与 Trace](/sessions-and-traces)。

### OmniMessage

OmniMessage 是 PenguinHarness 各处通用的统一消息格式：SDK 用它流式输出，Trace 用它存储，引擎内部也用它运转。产品宣传中也叫 Penguin Message，文档一律使用 OmniMessage。

见 [OmniMessage 协议](/omni-message)。

### 审批模式

每次工具调用在执行前都要经过放行或拒绝，由审批模式决定怎么做。审批模式有四种：`allow-all`、`deny-all`、`read-only`（只读工具直接执行，其余等你确认）和 `always-ask`。审批模式按 Session 分别设置。

见[工具与审批](/tools#审批)。

### 子 Agent

子 Agent 是 Agent 用 `run_subagent` 工具启动的下级 Agent，在同一个 Workspace 里处理一项独立的子任务。它运行在自己的 Session 中，有自己的 Trace，完成后把最终答复交回启动它的 Agent。

见[工具与审批](/tools#子-agent)。

## Agent 可用的能力

### 工具

工具是 Agent 能执行的操作。内置工具可以运行 shell 命令（`exec_command`、`input_command`），读取和编辑文件（`read_file`、`edit_file`、`write_file`），以及把工作交给子 Agent（`run_subagent`、`input_subagent`）。

见[工具与审批](/tools)。

### Skill

Skill 是一套可复用的指令：一个包含 `SKILL.md` 及其引用文件的目录。系统提示词里只列出每个已安装 Skill 的名称和描述，任务需要时，Agent 再读取完整的 `SKILL.md`。

见[技能与插件](/skills)。

### 插件

插件是插件库安装的单位，包含 Skill、钩子包，或两者都有。把插件装到某个 Agent 上，这些内容就会放进这个 Agent 的 Agent State。服务端插件是另一类插件：由服务端模块组成的 npm 包，例如沙箱后端，由 Project 要求服务器运行。

见[技能与插件](/skills)。

### 钩子包

钩子包是一组脚本，PenguinHarness 会在 Agent 运行循环的几个固定节点运行它们：提交 Prompt 时、每次工具调用审批之前，以及 Task 结束时。钩子可以拒绝一次工具调用，也可以再发起一个 Task，让 Agent 继续工作。

见[技能与插件](/skills#钩子包)。

### MCP Server

MCP Server 是通过 Model Context Protocol 提供工具的程序或服务。它提供的工具会加入 Agent 的工具集，和内置工具走同样的审批。

见[工具与审批](/tools#mcp-server)。

### 记忆

记忆是 Agent 在不同 Session 之间记住的内容，比如你的偏好和项目中的决定。记忆以 Markdown 文件的形式存放在 Agent State 里，分为每个 Session 都会读取的用户作用域，以及每个 Workspace 各自的作用域。不同 Agent 之间从不共享记忆。

见[配置参考](/configuration#记忆)。

### Vault

Vault 以环境变量的形式保存 Agent 的密钥等机密。变量值只会注入 Agent 的工具启动的进程，绝不会进入模型或 Trace；模型最多只能看到变量名。

见[配置参考](/configuration#vault)。

### 定时任务

定时任务按设定的时间向 Agent 发送 Prompt，可以发到已有的 Session，也可以每次新建一个 Session。只有服务端在运行时，定时任务才会执行。

见[定时任务](/schedules)。

## Agent 如何进化

### Benchmark

Benchmark 是一组题目，用来衡量 Agent 处理某类工作的能力。Benchmark 属于 Project 而不属于某个 Agent，因此可以评估 Project 里的任何 Agent。

见[评估中心](/evaluation-center)。

### 题目

题目是 Benchmark 里的一道测试。它包含题面和私有的评分标准：题面交给被测 Agent，评分标准只用来打分，被测 Agent 看不到。题目的每次运行都按满分 100 分打分。

见[自我进化](/self-improvement#benchmark-存储)。

### 评估

评估让 Agent 把 Benchmark 的每道题目按设定的次数跑完，并把分数、成本和耗时记录到 Benchmark 的记分板上。只有 Agent、模型和思考等级都相同时，分数之间才可以比较。

见[评估中心](/evaluation-center)。

### 优化

优化是根据评估结果改进 Agent。优化器 Agent 修改被优化 Agent 的 `AGENTS.md`、Skill 和配置，再评估改动的效果：分数严格提升才保留改动，否则回滚。

见[自我进化](/self-improvement)。

### 版本

Agent 的版本是 `system_config.yaml` 里的一个数字，每保留一次优化就加一。

见[自我进化](/self-improvement#快照与版本)。

### 快照

快照是 Agent State 某个版本的打包副本，保存为 `snapshots/v<version>.tar.gz`，不包含 Vault。优化在修改 Agent 之前，会先确保当前版本已经有快照。快照可以导出、导入，也可以用导出的快照创建新的 Agent。

见[自我进化](/self-improvement#快照与版本)。

## 模型与 Token

### 供应商

供应商是 Project 模型表里的一个具名分组，例如 `deepseek`、`anthropic` 或 `tokendance` 网关。PenguinHarness 内置了一批分组，你也可以添加自己的分组。

见[模型与 Provider](/models)。

### 模型

模型始终以 `(provider, model_id)` 二元组标识：它所属的供应商分组，加上它在该供应商处的 id。PenguinHarness 绝不根据 id 猜测供应商。每个 Project 都有一个默认模型，启动 Session 时由你选择模型。

见[模型与 Provider](/models)。

### 思考等级

思考等级决定模型在回答前推理多少，可选 `none`、`low`、`medium`、`high`、`xhigh` 或 `max`。每个 Agent 都有默认等级，没改过就是 `medium`；在 Session 里也可以换成其他等级。

见[模型与 Provider](/models)。

### Token

Token 是模型计量文本的单位。用量和成本都按 Token 计算，成本中心会按 Agent、模型和时间范围统计它们。

见[成本中心](/usage)。

## 公司模式

公司模式是 Web App 的一种 Beta 工作模式，让一个 Project 的 Agent 像一家公司那样自行运转。它默认关闭，需要管理员在**设置**里开启。

### 组织

组织就是一家公司：一个使命、一批员工，以及他们共用的日历、工单、频道和公共工作区。组织属于某个 Project，一个 Project 可以有多个组织，组织之间互不可见。

见[公司模式](/company-mode)。

### 员工

员工是被任用进组织的 Agent，有头衔、职责和汇报对象。全体员工组成一棵汇报树，CEO 是树根。

见[公司模式](/company-mode)。

### 工位会话

每个员工都有一个工位会话，也就是员工在组织里的常设 Session。日程项、频道里的 @提及和人发来的消息都送到这里。工位会话负责安排工作，并发起工单会话去完成它。

见[公司模式](/company-mode)。

### 工单

工单是组织里的一个工作单位，以 Markdown 文件的形式放在看板上。工单沿着看板的各列流转，从「提议」到「已完成」或「已拒绝」，由一个或多个工单会话推进。

见[公司模式](/company-mode)。

### 频道

频道是组织内的一条消息流，人和员工在这里交流。消息只有 @ 了某个员工或 @all，才会送达那个员工。每个组织都有一个全员频道，所有人都在其中。

见[公司模式](/company-mode)。
