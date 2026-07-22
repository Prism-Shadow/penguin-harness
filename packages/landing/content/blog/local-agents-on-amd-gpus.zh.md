---
title: 深入了解 PenguinHarness——并在 AMD GPU 上本地跑通一个自我进化的 Agent
date: 2026-07-20
category: practice
author: 张宁（AMD）、高钰洋（AMD）、郑耀威（PrismShadow）
excerpt: PenguinHarness 到底是什么、它的架构背后有哪些理念，以及一次真实的端到端运行——一个完全本地、运行在 AMD GPU 上的开源权重模型，先在一个打分任务上失败，再通过自己诊断并改写自身文件，把分数从大约半数递归自我提升到接近满分，全程数据不出本机。
---

*AMD × PrismShadow——张宁、高钰洋（AMD），郑耀威（PrismShadow）。*

如果你是第一次接触 PenguinHarness，这篇文章是一次完整的导览：这个项目是什么、它的架构背后有哪些设计理念，以及——为了让一切足够具体——一次真实的运行：一个完全本地、跑在 AMD GPU 上的开源权重模型，先在一个打分任务上失败，再由它自己诊断失分、改写自身文件，把分数从大约半数递归自我提升到接近满分，全程没有一个字节离开本机。

## PenguinHarness 是什么

PenguinHarness 是一个开源的 AI Agent Harness——一套用于*构建*和*进化* Agent 的完整 TypeScript 技术栈，而不是某一个具体应用。它可以完全本地部署，最低单 CPU 即可运行，并通过一个统一网关触达 1000+ 在线与本地模型。它的主旨只有一句话：

> Efficient Self-Improving Harness for Everyone.（为每个人打造的、高效的自我进化 Harness。）

"Harness"（挽具 / 骨架）这个词是刻意选择的。它不是一个让你*在其之上*层层搭建的重型框架，而是一层轻薄、可靠、可观测的底座——Agent 可以*站在其中*运行，更关键的是，Agent 可以反过来触及并改进它自己。三大支柱承载了这一理念：

| 支柱 | 含义 |
| --- | --- |
| **Simplest Is the Best（大道至简）** | 在干净的底层接口之上，提供刻意精简的工具集：更少的工具调用、更少的 Token、复杂任务高效完成。 |
| **构建 Agent 的 Harness** | 既可用 SDK 编程构建（`createAgent` → `createSession` → `run`），也可由一个 Agent 根据一句需求描述，自动造出一个全新 Agent。 |
| **递归自我进化的 Harness** | 借助 Skills，一个 Agent 能评估并优化*它自己*，随时间递归改进。 |

后两点，PenguinHarness 是业界首个开源实现。

## 架构，以及它为何长成这样

一次安装即可获得共享同一个数据目录和同一套消息协议的四层：

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

系统的中心是 `@prismshadow/penguin-core` 里的执行引擎。CLI、Server、Web App 只是同一个引擎的不同"Human 实现"。这一个决定——单一内核、多前端——正是让整个系统保持自洽的关键，而它源自一组值得单独理解的设计信条。

### 一套协议，三重身份——OmniMessage

系统所做的一切都用同一种消息类型 OmniMessage 表达。它同时是：

- SDK 的对外接口（你输入的、以及流式返回的），
- 磁盘上的 Trace 格式，
- 引擎内部流转的"通货"。

换句话说，*实时流式的内容、落盘存储的内容、模型看到的内容，是字面意义上的同一个对象*。中间没有一个隐形的转换层在"实际发生了什么"和"被记录了什么"之间悄悄改写数据。正是这种"三位一体"，构成了其余一切可观测性与可恢复性的根基。

### 三接口边界

引擎只讲 OmniMessage，并在恰好三个边界之间编排信息流：

- **Human**——用户侧。值得注意的是它*不是*一个类：SDK 唯一的入口 `session.run(newMessages, { approve, signal })` *就是* Human 边界。输入是一组新消息加一个审批回调，输出是一串流式消息。CLI 和 Server 是它的两个官方实现。
- **LLM**——模型侧（`LLMInterface`）。所有与厂商相关的协议适配都活在 AgentHub 网关里；core 从不导入任何厂商 SDK。这正是为什么任何 OpenAI 兼容端点——包括本地端点——都能开箱即用。
- **Environment**——工具侧（`EnvironmentInterface`）。执行已审批的工具调用并把结果流式返回。

因为内核不含任何 provider、工具或 UI 的具体细节，每一侧都仅靠配置即可替换。今天的本地 shell 可以变成明天的沙箱；一个 CLI 调用方可以换成 Web 调用方——core 始终不变。

### Agent 是可编辑的数据，不是代码

一个 Agent 的全部行为——它的提示词、Skills、运行参数——都以磁盘上的可编辑文件形式存在（`agent_state/`），而非硬编码常量。这是整个项目安静而关键的一点：*你能看到的，Agent 就能改进*。自我进化不是引擎的某个特殊功能，而是一个 Agent 去编辑那些你本可以手动编辑的同一批文件，然后重新评估自己。

### 贯穿始终的其余信条

- **错误收敛为消息。** 模型与工具的失败从不向引擎抛异常；它们会变成模型可以据此反应的消息。健壮性是协议的属性，而非散落各处的 try/catch。
- **一切皆可观测。** 每一次请求、工具调用、审批决策都会追加进 Trace；一个 Session 可完整从中恢复。
- **流式优先。** 文本逐 Token 流出；工具调用与结果实时呈现。
- **模型与 Agent 解耦。** Agent 从不绑定模型——在创建每个 Session 时选择。同一个 Agent 可以在不同 Session 上跑不同模型。

分层的一句话总结：*可编辑或需记录的活在文件里；让消息流动的活在 SDK 里；需要常驻进程与多用户的活在 Server 里；其余的都是渲染。*

## 大道至简——只有 6 个工具，以及这为何重要

第一根支柱最容易被忽略，却是你在实际使用中感受最深的：工具集刻意做得极小。PenguinHarness 只内置恰好 6 个工具：

| 工具 | 用途 |
| --- | --- |
| `exec_command` | 在工作区里执行 shell 命令（流式返回 stdout/stderr） |
| `input_command` | 驱动一个运行中的命令——写 stdin、发 Ctrl-C、轮询输出 |
| `run_subagent` | 把一个自包含的子任务委派给子 Agent |
| `input_subagent` | 轮询后台子 Agent，或在其空闲后追加提示 |
| `read_image` | 把图片作为图像内容读入（视觉模型） |
| `describe_image` | 让视觉模型把图片描述成文本（供纯文本模型使用） |

注意这里*没有*什么：没有 `read_file`、没有 `write_file`、没有 `edit_file`、没有 `list_dir`、没有 `grep` 工具。这是刻意的——shell 就是通用接口，所以文件的读、写、改全部通过 `exec_command` 走（`cat`、`>`、`sed` 等等）。它遵循的原则就是"大道至简"：每多一个工具，就是提示词里多一段 schema、每次调用多一些 token、模型多一个可能选错的选项。工具越少，选错越少、token 开销越小——复杂任务反而做得更利落。

这不只是理论——你可以直接从 Trace 里读出来。下面就是那个 CSV 清洗 Case，Agent 完成整个任务所做的全部 3 次工具调用，全都是 `exec_command`：

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

读文件、做转换、核对结果——3 次调用、1 个工具、没有任何专用文件机制。再留意第二步：正因为接口是一个 shell，模型很自然地用起了 Python 来表达去重逻辑——这是任何固定的 `edit_file` 工具都做不到的。精简的工具集不是模型需要绕过的限制；它恰恰*正是*一个有能力的模型能用极少步骤完成真实任务的原因。

## 用 Agent 造 Agent——一个完整的例子

这就是第二根支柱——构建 Agent 的 Harness——的具体呈现。它有两面。第一面是 SDK：你用几行代码就能把一个 Agent 嵌进自己的程序——`createAgent()` → `createSession()` → `session.run(...)`（文末有代码片段）。第二面更惊艳，也正是"Agent 是可编辑的数据"的另一面：如果一个 Agent 不过是一堆文件，那么*一个 Agent 就能替你把这些文件写出来*。这正是内置 `agent-creation` skill 所做的事——给它一句大白话需求，一个 Agent 就能搭建出一个全新的 Agent：它的目录布局、它的 `system_config.yaml`（名称与描述），以及最关键的 `AGENTS.md`——那个把需求变成行为的文件。为了把这第二面端到端地展示出来，我们就在本地 AMD GPU 这套技术栈上真跑了一次。

**需求。** 我们让本地的 `qwen3.6:35b`，通过 `agent-creation` skill：

> 创建一个叫 `commit-helper` 的新 Agent，专门写 Conventional Commits 提交信息——`type(scope): subject` 的标题（type 取自 feat/fix/docs/…）、祈使句、subject 控制在约 50 字符内，空一行，然后是一段解释"为什么"的正文。

**它产出了什么。** 这个 Agent 自主完成了：创建新 Agent 的目录、复制一份 base config、设置名称与描述，并写出了一份质量相当高的 `AGENTS.md`——涵盖了标题格式、type 枚举、subject 长度规则、正文"解释 why 而非 what"、可选的 `BREAKING CHANGE`/`Closes #` 脚注，甚至还有一条"从 diff 推断 type"的启发式（例如"重命名 → refactor 而非 chore"）。内容层面完全没有需要人工提点。

**然后我们运行了它造出来的这个 Agent。** 给刚创建的 `commit-helper` 一段改动描述（"给支付客户端加了带退避的重试，因为网关偶发的 503 导致下单失败"），它——只依据为它写的那份 `AGENTS.md`——产出了：

```text
fix(payment): add retry-with-backoff for transient gateway 503 errors

Transient 503 responses from the payment gateway were causing
checkout failures for users during peak traffic. Retry with
exponential backoff gives the gateway time to recover, preventing
spurious user-facing errors without requiring manual retries.
```

它甚至先"出声"权衡了这个改动到底算 `fix` 还是 `feat`，才最终定为 `fix`——这个行为完全来自它的父 Agent 为它写的 AGENTS.md。

**你可以自己跑一遍。** 上面整个流程在仓库里有一个自包含、纯 SDK 驱动的脚本：
[`examples/build-agent-with-agent/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/build-agent-with-agent)。
第一阶段用 `createAgent`/`createSession`/`run` 驱动 `default_agent` 造出 `commit-helper`；第二阶段加载这个新 Agent 并运行它——全部跑在本地 Ollama + qwen3.6:35b 上，不用任何云端 API。一次性的 Ollama 配置见其 `README.md`。

## 自我进化，一句话概括

第三根支柱建立在同一个理念之上。因为 Agent 是可编辑的数据、且一切皆被追踪，一个 Agent 可以*度量自己并变得更好*——这是一个"定基准 → 评估 → 找到失分点 → 编辑 Agent 自己的文件 → 只有分数提升才保留"的循环。它背后没有任何专用引擎代码，就是由 Skills 编排的普通 Agent 机制，而 scoreboard 上的每一个数字都能追回到产生它的那次具体 Session。我们会在下面这次运行之后，用一次真实的前后对比，把整个循环走一遍。

## 在 AMD GPU 上的一次真实本地运行

设计信条说起来容易。下面是一次真正践行了这些信条的端到端运行，全程在完全本地、开源权重、AMD GPU 的环境上进行——每一个 Token 都在本机生成，不向任何云端 API 发送。

**环境。** 一块 AMD GPU 运行 ROCm，通过 Ollama 的 OpenAI 兼容端点提供 `qwen3.6:35b`——一个能力不俗的本地开源权重模型（约 24 GB 的 MoE，36B 总参数，Q4_K_M 量化）。Ollama 原生识别到该 AMD GPU（无需任何架构 override），并把模型加载进显存。这条路径覆盖 AMD 受 ROCm 支持的整个产品线——从 Radeon PRO 工作站显卡（如 W7900，48 GB，RDNA3）一直到数据中心的 Instinct 加速卡。把它接入 PenguinHarness 只需一条命令，正因为 core 对任何 OpenAI 兼容端点一视同仁：

```bash
penguin config model add \
  --model-id qwen3.6:35b \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 \
  --api-key ollama --set-default
```

**任务，以及如何评分。** 我们给它一个看似平平无奇的任务：读一个项目 notes 文件，写一份含 2 句概述和恰好 3 条要点的摘要——*并遵守团队的标准报告格式。* 玄机全在最后这句：这个“团队格式”是一套任意的内部约定——一行特定 marker、一个 `# Report: <subject>` 标题、一行 `Classification: INTERNAL`、一行 `Reviewed-by: Aurora Team` 页脚——它*只存在于 Agent 的 `AGENTS.md` 里*，无法从任务本身推断。任务附带一份私有 rubric——一份 Agent 永远看不到的清单——共 10 分：5 分是任何有能力的模型仅凭任务就能拿到的内容分，另外 5 分是只能从 `AGENTS.md` 得知的约定分。

**基线——以及它为何不是满分。** 跑在本地 AMD GPU 上、`AGENTS.md` 为空时，这个模型写出了一份相当合理的摘要——却稳定丢掉全部 5 个约定分，落在 **4.6 / 10** 左右（具体数字每次运行会有波动）。它别无选择：任务里没有任何东西透露那套内部约定，所以这是*信息缺口，不是能力缺口*——也正是为什么更强的模型也没法“自己想出来”。而因为每一步都在 Trace 里，这不是靠猜——你可以打开这次运行，精确看到哪些分被丢了。

这就是诚实的起点：在本地硬件上，一个开箱即用的 Agent，面对规则藏在它尚未学过的文件里的任务，并不能一次拿满分。而这恰恰让下一节变得有意思——一个可度量、可审计、*可复现*的失败，Agent 可以通过自学来系统性修复。

## 自我进化到底是怎么运作的——附一次真实的前后对比

上面那个 4.6 / 10 是一次*评估*——是这个 Agent 当前状态的一张快照。更有意思的问题是：PenguinHarness 如何把这张快照变成进步。这就是递归自我进化循环，值得作为一种"机制"来理解，因为它背后没有任何魔法引擎代码——它就是由 Skills 编排的普通 Agent 机制：

1. **Benchmark（定基准）**——定义能力 Case，每个都配一份私有 rubric（如上）。
2. **Evaluate（评估）**——让 Agent 跑这些 Case 并按 rubric 打分。每一次运行都是一个普通的、被完整追踪的 Session。
3. **读 Trace 定位失分点**——因为每个分数都能追回到那次具体运行，你能看到某一分*为什么*被扣，而不只是"被扣了"。
4. **编辑 Agent 的状态**——Agent 的行为活在可编辑文件里（`AGENTS.md`、Skills、config）。你（或一个 Optimizer Agent）针对失分点去改这些文件，产出版本 N+1。
5. **快照 & 保留或回滚**——每轮前先打快照；只有当分数*严格提升*时才保留 N+1，否则回滚。

我们就来改进上一节里那个 Agent——同一个 `qwen3.6:35b`、同一块 AMD GPU、同一个刚拿了 4.6 / 10 的任务。关键之处在于：诊断和编辑都是 *Agent* 自己做的——我们并不把答案递给它。

- **诊断（由 Agent 完成）。** 我们只给 Agent 两个文件，别无其他：它刚被拒的那份报告，以及*另一个*项目里一份通过了评审的报告。没有人告诉它规则。它对比两者，自己推断出可复用的内部约定——marker、标题形态、元数据行、签名页脚。这就是"读 Trace 定位失分点"那一步，只不过由 Agent 亲自完成。
- **编辑（N → N+1），由 Agent 撰写。** Agent 把刚推断出的约定写进它自己的 `AGENTS.md`。从单一范例里它能正确还原出*结构*，但还分不清哪些 token 是固定常量、哪些是每份报告要替换的字段（单个范例本就有歧义），于是把 marker 泛化成了占位符。重新评估，分数升到约 **6.6 / 10**。没有重新训练、没有改代码——Agent 编辑的是一份它每次运行都会读的文本文件。
- **递归（N+1 → N+2）。** 现在我们再给它*多份*来自不同项目、却共享同一 marker 和签名的通过报告。Agent 推断出：凡是在所有样本里都完全相同的，必是固定常量；于是它读取自己*上一轮*写的 N+1 `AGENTS.md` 并精炼它——把 `<!-- ACME-DATA-PLATFORM -->` 和 `Reviewed-by: Aurora Team` 锁定为字面量。再评估一次：约 **9.8 / 10**。这才是真正意义上的递归：`state_{n+1} = agent.reflect(state_n, 新证据)`。

在同一个模型、同一个任务上，仅仅由 Agent 自己编辑一份它会读取的文本文件，分数就走出了 **4.6 → 6.6 → 9.8** 的轨迹（数字每次运行会有波动）——而且 harness 每一轮都只因分数严格提升才保留。这就是自驱动的循环：*Agent 能看到的，Agent 就能改进*——用一份 rubric 度量、关联着 Trace，不是拍脑袋。

**你可以自己跑一遍。** 整个循环在仓库里有一个自包含、纯 SDK 驱动的脚本：
[`examples/self-improving-agent/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/self-improving-agent)。
它用一份确定性的、可读的 rubric（10 分：5 分内容分、5 分只存在于 `AGENTS.md` 的内部约定分），并且——因为本地模型有随机性——对每个版本跑多次取平均分，这正是真实 benchmark 里 `runs`（多次运行）的意义所在。关键在于：脚本从不自己写那套约定；是 *Agent* 从一份通过范例里诊断出缺口，并编辑自己的 `AGENTS.md`。在我们的运行中，平均分沿着 **4.6 → 6.6 → 9.8** 走过两轮自撰改进（先学到结构、再锁定常量），harness 每一轮都只因分数严格提升才保留。它跑在同一套本地 Ollama + qwen3.6:35b 环境上，并使用一个专用 agent id，所以你自己的 Agent 不会被动到。

## 还没有 AMD GPU？来自 AMD + Fireworks 的免费云端算力

不是每个人桌下都有一块 AMD GPU——而要试用这一切，你并不需要它。通过 AMD AI Developer Program，AMD 与 Fireworks AI 合作，向符合条件的开发者提供**价值 50 美元的免费 Fireworks 额度**。Fireworks 通过 OpenAI 兼容端点提供开源权重模型，因此——和上面的本地 Ollama 一样——把 PenguinHarness 指向它也只是一行配置的事。

领取额度（审核通常需要 2–3 个工作日）：

1. 在 [AMD AI Developer Program](https://developer.amd.com/ai-developer-program/) 注册。
2. 进入 **Member Perks → Cloud Credit Options → Request Cloud Credits**。
3. 在表单中把"所需产品"选为 **Fireworks AI**，附上至少一个公开主页链接（GitHub、LinkedIn 等），提交。
4. AMD 会把优惠码发到你的邮箱。到 [fireworks.ai](https://fireworks.ai/) 通过 **Redeem Promo** 兑换，然后生成 API Key。

之后像接入任何其他端点一样把它接进 PenguinHarness：

```bash
penguin config model add --model-id <fireworks-模型-id> \
  --provider custom --client-type openai \
  --base-url https://api.fireworks.ai/inference/v1 \
  --api-key <你的-fireworks-key> --set-default
```

同一套 Harness、同样的一行切换——无论 Token 是在你自己的 AMD GPU 上生成，还是用 AMD 支持的云端额度生成。（请妥善保管优惠码与 Key；项目条款可能变动，具体以官方页面和审核邮件为准。）

## 这为什么重要

- **本地优先不是口号。** 一个完整的"构建 → 运行 → 自我评估"闭环在本机、在一块 AMD GPU 上跑通，没有数据离开机器——这是对隐私敏感与企业场景的真实回答。而且因为它跑在 ROCm + Ollama 之上，同一套配置可覆盖 AMD 的整个 GPU 阵容：单块 Radeon PRO 工作站显卡（如 48 GB 的 W7900）从 8B 到 30B 以上的模型都能从容运行，而 Instinct 加速卡则可进一步向上扩展。
- **薄模型层带来实际收益。** 因为 provider 适配完全活在网关里，"一个本地 Ollama 模型"和"一个前沿云端 API"只是同一处一行配置的差别。你不会被某个厂商锁定——也不会被某个 GPU 厂商锁定。我们这次跑在 AMD GPU（ROCm）上，但这里没有任何 AMD 专属的东西：同样的步骤在 NVIDIA GPU（Ollama 的 CUDA 后端）或 Apple Silicon 上一样成立——底层变的只是 Ollama 运行时，而 Harness、命令、example 全都保持不变。
- **可观测性内建于每一处。** 这次本地运行产生了与任何云端运行相同的只追加 Trace 与 scoreboard 关联。评估在设计上就是可审计的。

## 立即开始

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh

# 指向任意 OpenAI 兼容端点——包括一个本地 Ollama 模型
penguin config model add --model-id <你的模型> \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 --api-key ollama --set-default

penguin web   # 或：penguin run --approve allow-all --message "..."
```

想把它嵌进自己的程序？这就是"构建 Agent"支柱的 SDK 那一面——核心循环就是三次调用：

```ts
const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });
for await (const out of session.run([userText("...")], { approve: async () => "allow" })) { /* 流式处理 */ }
```

完整、可运行的版本见 [`examples/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples)——包括一个"用 Agent 造 Agent"和一个"自我改进的 Agent"，都跑在本地 Ollama 上。

无论你跑的是前沿云端模型，还是自己 AMD GPU 上的开源权重模型，PenguinHarness 都为你提供同一套精简、可观测、可自我进化的底座。在 [GitHub](https://github.com/Prism-Shadow/penguin-harness) 关注我们，并提交你的第一个 issue。
