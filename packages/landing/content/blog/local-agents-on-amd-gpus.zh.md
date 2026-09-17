---
title: "在 AMD GPU 上用 PenguinHarness 本地运行自我进化的 Agent"
date: 2026-07-20
category: practice
author: 张宁（AMD）、高钰洋（AMD）、郑耀威（PrismShadow）
excerpt: "先了解 PenguinHarness 的架构，再在 AMD GPU 上用本地开源权重模型运行它：让一个 Agent 构建另一个 Agent，再看 Agent 把自己的分数从约 4.6 提升到 9.8（满分 10），全程在本机完成。"
---

> 本文基于 PenguinHarness 0.1.1 撰写，之后的版本在部分细节上可能有所不同。

AMD × PrismShadow——张宁、高钰洋（AMD），郑耀威（PrismShadow）。

在这篇教程里，你将在 AMD GPU 上，用完全本地、开源权重的环境运行 PenguinHarness。每个 Token 都在本机生成，不向任何云端 API 发送内容。

你会先简要了解 PenguinHarness 的架构，然后在 GPU 上部署一个本地模型，让一个 Agent 根据一句话需求构建新 Agent，再看一个 Agent 在打分任务上失败之后，如何通过诊断失分原因、改写自己的文件实现自我进化。

完成本教程后，你将拥有：

- 在你的 AMD GPU 上由 Ollama 部署、并注册为 PenguinHarness 默认模型的 `qwen3.6:35b`；
- 一个由另一个 Agent 替你构建的 `commit-helper` Agent；
- 一次自我进化运行：两轮之内，分数从约 4.6 提升到约 9.8（满分 10）。

本教程面向初次接触 PenguinHarness 的开发者。如果没有 AMD GPU，第五步之后的一节介绍了如何改用 Fireworks 额度。

## 准备工作

- 一块受 ROCm 支持的 AMD GPU，已安装 ROCm，显存足以装下约 24 GB 的 `qwen3.6:35b`。
- 同一台机器上装有 Ollama。
- 克隆好的 [PenguinHarness 仓库](https://github.com/Prism-Shadow/penguin-harness)，以及 Node.js 24 或更高版本和 pnpm，用来运行第三步到第五步的两个示例。

不需要云端账号，也不需要 API Key。

## PenguinHarness 的架构

PenguinHarness 是一个开源的 AI Agent Harness：一套用于构建和进化 Agent 的完整 TypeScript 技术栈，而不是某一个具体应用。它可以完全本地部署，最低单个 CPU 即可运行，并通过一个统一网关接入 1000 多个在线和本地模型。它的宗旨可以用一句话概括：

> Efficient Self-Improving Harness for Everyone.（为每个人打造的、高效的自我进化 Harness。）

「Harness」这个词是刻意选的。PenguinHarness 不是一个让你在其上层层搭建的重型框架，而是一层轻薄、可靠、可观测的底座：Agent 在其中运行，也能反过来触及并改进它。三大支柱承载了这一理念：

| 支柱 | 含义 |
| --- | --- |
| **Simplest Is the Best（大道至简）** | 在干净的底层接口之上，提供刻意精简的工具集：更少的工具调用、更少的 Token，高效完成复杂任务。 |
| **构建 Agent 的 Harness** | 既可以用 SDK 编程构建（`createAgent` → `createSession` → `run`），也可以让一个 Agent 根据一句自然语言需求，替你构建一个全新的 Agent。 |
| **递归自我进化的 Harness** | 借助 Skill，Agent 评估并优化自己，随时间递归改进。 |

在后两根支柱上，PenguinHarness 是同类项目中第一个开源实现。

### 一个内核，多个前端

一次安装即可得到四层结构，它们共享同一个数据目录和同一套消息协议：

```text
┌─────────────┐  ┌─────────────────────────────┐
│   CLI       │  │  Web App (React SPA)        │
│  (penguin)  │  │    ↑ OmniMessage over SSE   │
│             │  │  Server (Hono + SQLite)     │
└──────┬──────┘  └──────────────┬──────────────┘
       │      session.run(...)  │        ← Human 边界
┌──────┴────────────────────────┴──────────────┐
│  core: context_engine（ReAct 循环）          │
│    ├── LLMInterface ──→ AgentHub ──→ 模型    │
│    ├── EnvironmentInterface ──→ 内置工具     │
│    ├── Agent State（可编辑文件）             │
│    └── Trace（只追加 JSONL）                 │
└──────────────────────────────────────────────┘
```

系统的中心是 `@prismshadow/penguin-core` 里的执行引擎。CLI、Server 和 Web App 只是同一个引擎的不同「Human 实现」。「单一内核、多个前端」这一个决定，让整个系统保持自洽。它源自几条设计原则，下面逐一介绍。

### OmniMessage：一套协议，三种职责

系统所做的一切，都用同一种消息类型 OmniMessage 表达。它同时是：

- SDK 的对外接口（你传入的消息和流式返回的消息）；
- 磁盘上的 Trace 格式；
- 引擎内部流转的通用数据。

实时流出的内容、落盘存储的内容、模型看到的内容，是字面意义上的同一个对象。在「发生了什么」和「记录了什么」之间，没有一个隐形的转换层在悄悄改写数据。正是这种同一性，构成了系统其余部分所依赖的可观测性和可恢复性的基础。

### 三接口边界

引擎只认 OmniMessage，并在恰好三个边界之间编排信息流：

- **Human**：用户侧。它不是一个类：SDK 唯一的入口 `session.run(newMessages, { approve, signal })` 就是 Human 边界。输入是一组消息加一个审批回调，输出是一串流式消息。CLI 和 Server 是它的两个官方实现。
- **LLM**：模型侧（`LLMInterface`）。所有与供应商相关的协议适配都放在 AgentHub 网关里，core 从不引入任何厂商 SDK。正因如此，任何 OpenAI 兼容端点（包括本地端点）都能直接使用。
- **Environment**：工具侧（`EnvironmentInterface`）。它执行通过审批的工具调用，并把结果流式返回。

内核不包含任何供应商、工具或 UI 的具体细节，所以每一侧都只靠配置就能替换。今天的本地 shell 明天可以换成沙箱，CLI 调用方也可以换成 Web 调用方，core 始终不变。

### Agent 是可编辑的数据，不是代码

Agent 的全部行为（提示词、Skill 和运行参数）都以可编辑文件的形式保存在磁盘上的 `agent_state/` 里，而不是写死的常量。这是整个项目的关键：你能看到的，Agent 就能改进。自我进化不是引擎的某个特殊功能，而是 Agent 去编辑那些你本来也可以手动编辑的文件，然后重新评估自己。第五步会展示这一点。

### 贯穿始终的设计原则

- 错误收敛为消息。模型和工具的失败从不向引擎抛出异常，而是变成模型可以据此应对的消息。健壮性是协议本身的属性，不靠散落各处的 try/catch。
- 一切皆可观测。每一次请求、工具调用和审批决定都会追加进 Trace，Session 可以据此完整恢复。
- 流式优先。文本逐 Token 流出，工具调用和结果实时呈现。
- 模型与 Agent 解耦。Agent 从不绑定模型：模型在每个 Session 里单独选择，同一个 Agent 可以在不同的 Session 上跑不同的模型。

这套分层可以用一句话总结：可编辑或需要记录的放在文件里；让消息流动的放在 SDK 里；需要常驻进程和多用户的放在 Server 里；其余都是渲染。

### 六个内置工具

第一根支柱最容易被忽略，实际使用中的感受却最深：工具集刻意做得极小。本文写作时，PenguinHarness 恰好只内置六个工具：

| 工具 | 用途 |
| --- | --- |
| `exec_command` | 在 Workspace 里执行 shell 命令（流式返回 stdout/stderr） |
| `input_command` | 操作运行中的命令：写入 stdin、发送 Ctrl-C、轮询输出 |
| `run_subagent` | 把一个自包含的子任务委派给子 Agent |
| `input_subagent` | 轮询后台子 Agent，或向它追加提示 |
| `read_image` | 把图片作为图像内容读入（视觉模型） |
| `describe_image` | 让视觉模型把图片描述成文字（供纯文本模型使用） |

当时没有 `read_file`、`write_file`、`edit_file`、`list_dir` 或 `grep` 工具，这是有意为之。shell 就是通用接口，读、写、改文件全部通过 `exec_command` 完成（`cat`、`>`、`sed` 等）。每多一个工具，提示词里就多一段 schema，每次调用都多花一些 Token，模型也多一个可能选错的选项。工具越少，选错的调用越少，Token 开销也越小。

这一点可以直接从 Trace 里读出来。下面是一个 Agent 完成一道 CSV 清洗题目时的全部三次工具调用，全都是 `exec_command`：

```bash
# 1. 读输入——没有 read_file 工具，直接 cat
cat users.csv

# 2. 干活——shell 让模型自然地用上 Python
python3 -c "
import csv
rows = list(csv.DictReader(open('users.csv', newline='')))
cleaned = [r for r in rows if (r.__setitem__('email', r['email'].strip().lower()) or r['email'])]
seen, out = set(), []
for r in cleaned:
    key = tuple(r.values())
    if key not in seen: seen.add(key); out.append(r)
# ... 写出 users_clean.csv，保持列序不变 ...
"

# 3. 读回结果做自检——同样只是 cat
cat users_clean.csv
```

读文件、做转换、核对结果：三次调用、一个工具，没有任何专用的文件机制。再看第二次调用：正因为接口是 shell，模型很自然地用 Python 写出了去重逻辑，这是任何固定的 `edit_file` 工具都做不到的。精简的工具集不是模型需要绕过的限制；有能力的模型之所以能用这么少的步骤完成真实任务，靠的正是它。

## 第一步：安装 PenguinHarness

用一行安装命令安装 PenguinHarness：

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
```

安装完成后就有了 `penguin` CLI，下一步用它注册本地模型。

## 第二步：在 AMD GPU 上部署 qwen3.6:35b

这一步用 Ollama 部署一个本地模型，并在 PenguinHarness 中注册它。

模型是 `qwen3.6:35b`，一个能力不俗的本地开源权重模型：约 24 GB 的 MoE，总参数量 36B，Q4_K_M 量化。在 ROCm 下，Ollama 能原生识别 AMD GPU，无需设置任何架构 override，就能把模型加载进显存。这条路径覆盖 AMD 受 ROCm 支持的整个产品线，从 Radeon PRO 工作站显卡（如 W7900，48 GB，RDNA3）一直到数据中心的 Instinct 加速卡。

启动 Ollama 并拉取模型：

```bash
ollama serve &          # 若尚未作为服务运行
ollama pull qwen3.6:35b
```

然后在 PenguinHarness 中注册这个模型，并设为默认模型：

```bash
penguin config model add \
  --model-id qwen3.6:35b \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 \
  --api-key ollama --set-default
```

一条命令就够了，因为 core 对任何 OpenAI 兼容端点一视同仁，而 Ollama 正好在 `http://localhost:11434/v1` 提供这样一个端点。

## 第三步：让 Agent 构建新 Agent

这一步由一个 Agent 替你构建新 Agent，第二根支柱「构建 Agent 的 Harness」在这里落到实处。

这根支柱有两面。第一面是 SDK：几行代码就能把 Agent 嵌进你自己的程序，即 `createAgent()` → `createSession()` → `session.run(...)`（见文末的「后续步骤」）。第二面源于「Agent 是可编辑的数据」：既然 Agent 不过是一组文件，Agent 就能替你把这些文件写出来。内置的 `agent-creation` Skill（0.2.4 起更名为 `agent-initialization`）做的正是这件事。给它一句自然语言需求，Agent 就能搭建出一个新 Agent：目录结构、`system_config.yaml`（名称和描述），以及最关键的 `AGENTS.md`，也就是把需求变成行为的那个文件。

仓库里的示例 [`examples/build-agent-with-agent/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/build-agent-with-agent) 把整个流程做成了一个自包含、由 SDK 驱动的脚本，跑在本地 Ollama + qwen3.6:35b 上，不调用任何云端 API。一次性的 Ollama 配置见其 `README.md`。在仓库根目录运行：

```bash
pnpm install
pnpm build
pnpm --dir examples/build-agent-with-agent start
```

第一阶段，脚本通过 `createAgent`/`createSession`/`run` 驱动 `default_agent` 构建 `commit-helper`。本地的 `qwen3.6:35b` Agent 借助 `agent-creation` Skill，收到的请求是：

> 创建一个叫 `commit-helper` 的新 Agent，专门写 Conventional Commits 提交信息：`type(scope): subject` 格式的标题（type 取自 feat/fix/docs/…），subject 用祈使句并控制在约 50 个字符以内，空一行，然后是一段解释为什么要改的正文。

Agent 会自主创建新 Agent 的目录、复制一份基础配置、设置名称和描述，并写出一份质量相当高的 `AGENTS.md`。文件里写明了标题格式、type 枚举、subject 长度规则、正文要「解释为什么改，而不是改了什么」、可选的 `BREAKING CHANGE`/`Closes #` 脚注，甚至还有一条从 diff 推断 type 的经验规则（例如「重命名 → refactor，而不是 chore」）。内容上完全不需要人工提点。

第二阶段，脚本加载这个新 Agent，让它处理一段改动描述：「给支付客户端加了带退避的重试，因为网关偶发的 503 导致下单失败」。刚创建好的 `commit-helper` 只依据为它写的 `AGENTS.md`，产出了：

```text
fix(payment): add retry-with-backoff for transient gateway 503 errors

Transient 503 responses from the payment gateway were causing
checkout failures for users during peak traffic. Retry with
exponential backoff gives the gateway time to recover, preventing
spurious user-facing errors without requiring manual retries.
```

它甚至会先出声权衡这个改动算 `fix` 还是 `feat`，最后才定为 `fix`。这一行为完全来自父 Agent 为它写的 `AGENTS.md`。

## 第四步：测量基线

这一步给一个 `AGENTS.md` 为空的 Agent 打分，而任务的规则它看不到。

任务看起来平平无奇：读一个项目笔记文件，写一份摘要，包含 2 句概述和恰好 3 条要点，并遵守团队的标准报告格式。关键全在最后这个要求。所谓「团队格式」是一套随意定下的内部约定：一行特定的标记、一个 `# Report: <subject>` 标题、一行 `Classification: INTERNAL`，以及一行 `Reviewed-by: Aurora Team` 页脚。它只写在 Agent 的 `AGENTS.md` 里，从任务本身推断不出来。

任务附带一份私有评分细则，也就是 Agent 永远看不到的一份检查清单，满分 10 分：

- 5 分给内容，任何有能力的模型仅凭任务本身就能拿到；
- 5 分给约定，只有从 `AGENTS.md` 里才能得知。

仓库里的示例 [`examples/self-improving-agent/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/self-improving-agent) 把这个任务和随后的改进闭环做成了一个自包含、由 SDK 驱动的脚本。它使用一份确定性的、可读的评分细则，同样是这 10 分；跑在同一套本地 Ollama + qwen3.6:35b 环境上；并使用一个专用的 Agent id，不会动到你自己的 Agent。在仓库根目录启动：

```bash
pnpm --dir examples/self-improving-agent start
```

脚本报告的第一个分数就是基线。`AGENTS.md` 为空时，模型写出的摘要相当合理，却稳定地丢掉全部 5 个约定分，落在 4.6 / 10 左右。具体数字每次运行会有波动。本地模型的输出有随机性，所以脚本对每个版本取多次运行的平均分，这也正是真实的 Benchmark 要设置 `runs` 次数的原因。

模型别无选择。任务里没有任何信息透露这套内部约定，所以这是**信息缺口，而不是能力缺口**，这也是更强的模型同样无法「自己想出来」的原因。每一步都记录在 Trace 里，打开这次运行，就能准确看到丢了哪几分。

这就是诚实的起点：在本地硬件上，一个开箱即用的 Agent，面对规则写在它尚未学过的文件里的任务，并不能拿到满分。而一个可测量、可审计、可复现的失败，Agent 可以通过自学系统地修复，下一步就会展示。

## 第五步：让 Agent 自我进化

这一步，同一次运行会继续进入自我进化闭环。诊断和修改都由 Agent 自己完成，没有人把答案交给它。

这个闭环有五个阶段。背后没有任何特殊的引擎代码，只是由 Skill 编排的普通 Agent 机制：

1. Benchmark：定义能力题目，每道题配一份私有评分细则，和第四步一样。
2. 评估：让 Agent 跑这些题目，并按评分细则打分。每一次运行都是一个普通的、全程留有 Trace 的 Session。
3. 读 Trace，找出丢分点：每个分数都能追溯到具体的那次运行，所以你不只知道丢了分，还能看到为什么丢分。
4. 编辑 Agent State：Agent 的行为保存在可编辑的文件里（`AGENTS.md`、Skill、配置）。由你或一个 Optimizer Agent 针对失败修改这些文件，产出版本 N+1。
5. 打快照，然后保留或回滚：每轮开始前先打快照；只有分数严格提升才保留 N+1，否则回滚。

在这个示例里，脚本只提供失败信号和通过审核的示例报告，并报告每一轮分数有没有提升，从不自己写入那套约定。

### 第一轮：学会结构

Agent 只拿到两个文件，别无其他：它刚被退回的那份报告，以及另一个项目里一份通过审核的报告。没有人告诉它规则。它对比两份报告，推断出可复用的内部约定：标记、标题形式、元数据行和署名页脚。这正是「读 Trace，找出丢分点」这个阶段，只不过由 Agent 亲自完成。

随后，Agent 把推断出的约定写进自己的 `AGENTS.md`，得到版本 N+1。从单个示例里，它能正确还原出结构，但还分不清哪些词是固定常量、哪些是每份报告各不相同的字段，因为单个示例本身就有歧义。于是它把标记泛化成了占位符。再次评估，分数升到约 6.6 / 10。没有重新训练，也没有改代码：Agent 改的只是一份它每次运行都会读取的文本文件。

### 第二轮：锁定常量

接下来，Agent 看到多份来自不同项目、共用同一个标记和署名页脚的合格报告。它推理出：凡是在所有报告里都完全相同的部分，必然是固定常量。于是它读取自己上一轮写的 N+1 版 `AGENTS.md` 并加以完善，把 `<!-- ACME-DATA-PLATFORM -->` 和 `Reviewed-by: Aurora Team` 锁定为字面量。再次评估，分数达到约 9.8 / 10。这才是真正意义上的递归：`state_{n+1} = agent.reflect(state_n, new_evidence)`。

两轮都让分数严格提升，这正是第 5 阶段保留修改的条件。

## 没有 AMD GPU？改用 Fireworks 额度

想动手试试，不一定需要 AMD GPU。通过 AMD AI Developer Program，AMD 与 Fireworks AI 合作，向符合条件的开发者提供价值 50 美元的免费 Fireworks 额度。Fireworks 通过 OpenAI 兼容端点提供开源权重模型，所以和本地 Ollama 一样，把 PenguinHarness 指向它也只需改一行配置。

领取额度（审核通常需要 2–3 个工作日）的步骤，请参阅 [Fireworks API 获取指南](https://penguin.ooo/blog/fireworks-credits-amd)，里面详细介绍了额度兑换和 API Key 的获取方法。

然后像接入其他端点一样，在 PenguinHarness 中注册 Fireworks：

```bash
penguin config model add --model-id <fireworks-模型-id> \
  --provider custom --client-type openai \
  --base-url https://api.fireworks.ai/inference/v1 \
  --api-key <你的-fireworks-key> --set-default
```

无论 Token 是在你自己的 AMD GPU 上生成，还是用 AMD 支持的云端额度生成，Harness 都不变，一行配置的切换方式也不变。请妥善保管优惠码和 API Key。计划条款可能变动，具体以官方页面和审核邮件为准。

## 结果

在我们的运行中，同一个模型、同一个任务的分数是这样爬升的，具体数字每次运行都会有波动：

| 版本 | Agent 写进 `AGENTS.md` 的内容 | 分数 |
| --- | --- | --- |
| N（基线） | 无，文件为空 | 约 4.6 / 10 |
| N+1 | 约定的结构，标记仍是占位符 | 约 6.6 / 10 |
| N+2 | 同一套约定，常量已锁定为字面量 | 约 9.8 / 10 |

分数的提升，完全来自 Agent 编辑了一份它每次都会读取的文本文件。这次运行说明了三点：

- 本地优先在 AMD 硬件上切实可行。完整的「构建 → 运行 → 自我评估」闭环在本机的一块 AMD GPU 上跑通，没有数据离开机器，这对隐私敏感的场景和企业环境是一个实实在在的答案。由于它建立在 ROCm + Ollama 之上，同一套配置适用于 AMD 的整个 GPU 产品线：单块 Radeon PRO 工作站显卡（如 48 GB 的 W7900）就能从容运行 8B 到 30B 以上的模型，Instinct 加速卡还能进一步向上扩展。
- 薄模型层带来实际收益。供应商适配全部放在网关里，所以「本地 Ollama 模型」和「前沿云端 API」之间只差一行配置。你不会被某个厂商锁定，也不会被某个 GPU 厂商锁定。我们这次跑在 AMD GPU（ROCm）上，但这里没有任何 AMD 专属的东西：同样的步骤在 NVIDIA GPU（Ollama 的 CUDA 后端）或 Apple Silicon 上一样可行。变的只是底层的 Ollama 运行时，Harness、命令和示例都保持不变。
- 可观测性处处内建。本地运行产生的只追加 Trace 和记分板关联，与任何云端运行完全相同，记分板上的每个数字都能追溯到产生它的那个 Session。评估从设计上就是可审计的。

## 后续步骤

这一路下来，你在 AMD GPU 上部署了本地模型，让一个 Agent 构建了 `commit-helper`，还看到一个 Agent 通过编辑自己的 `AGENTS.md` 提高了分数。

整套配置只需三条命令，适用于任何 OpenAI 兼容端点，包括本地 Ollama 模型：

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh

# 指向任意 OpenAI 兼容端点——包括一个本地 Ollama 模型
penguin config model add --model-id <你的模型> \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 --api-key ollama --set-default

penguin web   # 或：penguin run --approve allow-all --message "..."
```

想把 Agent 嵌进自己的程序，就用「构建 Agent」这根支柱的 SDK 那一面。核心循环只有三次调用：

```ts
const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });
for await (const out of session.run([userText("...")], { approve: async () => "allow" })) { /* 流式处理 */ }
```

完整、可运行的版本见 [`examples/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples)，其中包括一个构建其他 Agent 的 Agent 和一个自我进化的 Agent，都跑在本地 Ollama 上。在 [GitHub](https://github.com/Prism-Shadow/penguin-harness) 关注我们，提交你的第一个 issue。
