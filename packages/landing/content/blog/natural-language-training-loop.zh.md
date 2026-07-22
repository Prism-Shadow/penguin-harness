---
title: 让 Agent 来做，不要手动操作：一个数据安全的模型训练自闭环
date: 2026-07-22
category: practice
excerpt: PenguinHarness 0.1.1 新增了 ollama、vllm、llamafactory 三个技能。它们不是三个要你去学的命令行工具，而是 Agent 学会的东西——于是「在这台机器上跑一个本地模型」「把它微调到能过我的评测」变成了你说的一句话，而不是你敲的一串命令。随后的闭环会自己合上，而整个过程中的数据不出你自己的环境。
---

0.1.1 带来了三个技能：`ollama`、`vllm`、`llamafactory`。最容易的误读是：PenguinHarness 现在要你再学三个命令行工具。

恰恰相反。这些技能不是写给你的，是写给 Agent 的；它们存在的全部理由，就是让你不再敲这些命令。你用一句话说清楚要什么，Agent 自己选工具、问该问的问题、执行、验证，然后把结果讲给你听。

本文讲这件事带来的三点变化：

1. **接口是一句话。** 你输入什么，Agent 随后自己做了什么。
2. **闭环会自己合上。** 部署 → 评测 → 微调 → 重新部署 → 再测一次，每一步由 Agent 依据上一步的结果自行决定。
3. **你在意的数据不出域。** 端点在本地、训练在本地、权重在本地——哪里不再成立，下文会明说。

下文中归给 Agent 的每一项行为，都是已发布技能里真实写明的规则。这些技能就是普通的 Markdown，你可以自己去 `packages/skills/skills/` 下读。哪里是技能的边界、需要你接手，本文照实说明，不粉饰。

## 一、「在这台机器上跑一个本地模型，数据不要出去」

这句话就是全部输入。以下是它另一端发生的事。

**Agent 加载 `ollama` 技能，并在动手之前先问两个问题。** 这不是客气：技能明确规定目标不清楚之前不许执行任何命令。它问你要跑哪个模型——你没有偏好时，它会推荐一个小默认值 Qwen3.5-0.8B，并提醒模型必须装得进机器的内存或显存。它还问你偏好哪个引擎，因为这个选择确实属于你：Ollama 是简单默认项，也是 macOS 与纯 CPU 机器上的唯一选择；vLLM 面向高吞吐的 GPU 部署。

**然后它先看、再动。** 技能的第一条规则就是先确认当前状态——Ollama 装了没有、是不是已经在提供服务；如果 11434 端口上已经有实例，就复用它，绝不杀掉。这也正是 0.1.1 写进默认系统提示词的那条：绝不杀死不是自己启动的进程，端口被占就另选一个。

**然后它把你多半会做错的那几步做对。** 缺了就装 Ollama，拉取模型，并调大上下文窗口——这一步最常被跳过，然后花一个下午排查，因为 Ollama 默认的窗口很小，而 Agent 会话不小。技能给了它两条路：在服务环境里设 `OLLAMA_CONTEXT_LENGTH`，或者用 Modelfile 把 `num_ctx` 固化成一个模型变体。

**然后它先验证，再注册。** 拉下来的模型在被添加之前，对 PenguinHarness 是不可见的，而模型配置是 CLI 的职责：

```bash
# 这是 Agent 执行过的命令，不是给你照做的清单
curl http://localhost:11434/v1/models

penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 --model-id qwen3.5:0.8b --api-key ollama
penguin config model list
```

这条命令里的每个细节都是判断，不是模板，而 Agent 是从 `penguin-cli` 技能里学到它们的。PenguinHarness 里的模型由 `(provider, model_id)` 二元组确定，分组**永远不**从模型 ID 推断——网关会用上游 ID 转售厂商模型，猜错就可能把你的 Key 发到别人的端点上；`custom` 是内置分组之外任何端点所属的分组。`--client-type openai --base-url <endpoint>` 是所有 OpenAI chat-completion 兼容服务的写法。而 `--api-key ollama` 不是装饰：Ollama 接受任何 Key，但这个字段必须非空。

如果本地模型的上下文窗口很小，Agent 还有理由顺手限制输出——`--max-tokens` 是 0.1.1 新增的模型级上限，优先级高于 Agent 默认的 32,000；而这个默认值本身就塞不进 32k 窗口，更别提再加上提示词。

以上没有一条是你跑的。你做的是逐条批准工具调用。这是人仍然实实在在留在环里的第一处，而且是有意为之。

## 二、「把这个模型微调到能过我的评测」

正是这句话让闭环合上，而关键在「评测」两个字。没有数字就没有自我改进，而跑一次不算数字。

```text
      ┌───────────────────────────────────────────────┐
      │                                               │
   部署模型      →      跑评测        →      读失败的 Trace
 (vllm/ollama)   (benchmark-design +      (记分板里的 session id)
                   agent-evaluation)
      ↑                                               │
      │                                               ↓
   重新部署   ←    合并并导出    ←        针对失分微调
    (vllm)        (llamafactory)          (llamafactory)
```

**Agent 先把量具造出来。** `benchmark-design` 技能让它铺开一个 Benchmark 目录：一份 `benchmark_config.toml`、一份 `scoreboard.yaml`，以及每个 Case 一个目录，里面是被测 Agent 能看到的公开 `statement/README.md`，和它绝不能看到的私有 `rubric/README.md`。`runs` 默认为 3，于是不确定的本地模型是被平均，而不是只采样一次。整套 Case 的 Rubric 满分合计 100 分，分数因此始终可解释。接受一个 Case 之前，技能还要求它跑一次反事实检验：一个**不具备**该能力的执行者，能不能靠机械照做 Statement 通过？如果能，这个 Case 就被否掉重设计。

<details>
<summary><strong>展开：技能铺开的 Benchmark 目录</strong></summary>

```text
<benchmark_id>/
├── benchmark_config.toml
├── scoreboard.yaml
└── CASE-<nnn>-<semantic-name>/
    ├── statement/
    │   └── README.md
    └── rubric/
        └── README.md
```

两份 README 都是必需的，两个目录都可以放辅助文件。`statement/` 是完整的公开任务与材料，`rubric/` 是私有评分材料——Statement 里不得出现任何私有标准或路径。配置文件先写，而且刻意不记录模型：产生每次评估的 `(provider, model_id)` 二元组由该次评估自己记录。

```toml
title = "<benchmark_title>"
description = "<capability_and_scope>"
runs = 3
```

</details>

**然后它把评测扇出去。** N 个 Case、R 次运行，它会把 N × R 个评估作为并行子 Agent 调用一次性发出；每个子 Agent 加载 `agent-evaluation`，只做一个 Case 的一次运行。这个子 Agent 建立自己的一次性 Workspace，**只**把 Statement 拷进去，用指定的 `(provider, model_id)` 二元组通过 CLI 启动被测 Agent 恰好一次，然后机械地绑定 Trace——比对会话记录里的 Workspace、Agent State、provider 与 model id，而不是相信「最近跑的那个」。它返回的只有协议元数据：分数、成本、耗时、session id，一句自然语言都没有。这份沉默正是设计本身：Rubric 因此既不进入被测 Agent 的上下文，也不进入对话记录。

**于是 Agent 拿到的不只是一个数字。** 每次评估都记录产生它的 `(provider, model_id)` 二元组，基座模型与调优后的后继者因此落在同一张记分板上，可以直接比。而每一次 run 都带着自己的 session id，Agent 可以打开那次 Trace，看清是哪一步丢的分。

**然后它开始微调。** `llamafactory` 技能要求它在训练前确认四件事：可用显存（LoRA 的需求远低于全参微调）、基座模型、数据集及其格式、以及目标——常规起点是 LoRA SFT。它把数据集按 alpaca 或 sharegpt 格式登记进 `data/dataset_info.json`，从随附的 `examples/train_lora/qwen3_lora_sft.yaml` 派生出训练配置，执行 `llamafactory-cli train`，并在信任结果之前先交互试一下。

**然后它重新部署，再测一次。** 适配器被合并进基座权重并导出（技能写得很明确：绝不合并到量化过的基座上）。vLLM 可以直接部署导出目录，Ollama 则需要先导入。部署时，`vllm` 技能早就告诉过它那个所有人都会忘的参数：Agent Harness 会在请求里带上 `tools`，vLLM 必须在启动时用 `--enable-auto-tool-choice` 与匹配模型家族的 `--tool-call-parser` 显式开启，否则每一次工具调用都会返回 400。调优后的端点被注册成**独立**的模型 ID，而不是覆盖基座——正是为了让两者都留在记分板上——然后同一个 Benchmark 再跑一遍。

这就是闭环，而从「部署」到「再测一次」之间的每一步，都不需要你说出任何一条命令。

## 三、人还站在哪里

三个位置，都不是疏漏：

- **批准工具调用。** 每一次工具调用都要过闸。在 SDK 里这个闸就是一个回调函数，不提供它等于全部拒绝——默认是拒绝，而不是放行。
- **只能由你做的判断。** 用哪个基座模型、用哪个引擎、多好才算「够好」。三个部署与调优技能都写成**先问**而不是替你假设；`benchmark-design` 也要求你先指明被测 Agent 与要衡量的能力才肯开始。如果你想改进的是 Agent 本身而不是权重，`agent-optimization` 基于同一张记分板工作——而且在你从 Agent 设置里导出快照之前，它拒绝改动 Agent State，永远留着一条回滚路径。
- **数据集那道缝**，见第二部分结尾。

除此之外的一切——用哪些参数、哪个端口、哪个 parser、要不要复用已在运行的服务、遇到 `400 … tools must not be an empty array` 怎么办（升级到 0.1.1，它不再发送空工具列表）、vLLM 启动显存不足怎么办（调低 `--gpu-memory-utilization` 或 `--max-model-len`，或者部署量化模型）——都写在技能里，也就意味着都在 Agent 身上。

**还有一道缝，明说。** 把失败的 Trace 变成训练样本，是技能**没有**规定的一步。`llamafactory` 只问你数据集在哪、是什么格式，它并不教 Agent 如何从 Trace 里挖出一份 SFT 数据。Agent 能读 Trace（`benchmark-design` 让它逐条查看返回的会话），你让它写转换脚本它也能写——但那是你在指挥它，不是技能在驱动它。谁要是告诉你这一段已经全自动了，那多半是在卖东西。

## 四、数据安全不出域

这才是整套安排值得折腾的理由，所以它需要的是精确，而不是口号。

**这套配置下留在本地的部分：**

- **被部署的模型。** Ollama 在 `http://localhost:11434/v1` 暴露 OpenAI 兼容 API，vLLM 在 `http://localhost:8000/v1`。两者都在本机。对它们发起的 Agent 会话里，每一条提示词、工具 Schema、工具结果与补全，都留在本地回环接口上。
- **训练。** LlamaFactory 跑在你自己的 GPU 上。数据集放在 `data/` 下、与 `data/dataset_info.json` 相邻；适配器与合并后的导出落在 `saves/`。`llamafactory-cli train` 的任何阶段都不会把你的样本发出去。
- **评测。** Case、Statement 与 Rubric 都是你项目里的文件——一份 Rubric 的路径形如 `~/.penguin/data/default_project/agents/tool-router/benchmarks/tool-routing-v1/CASE-003-pick-the-cheaper-endpoint/rubric/README.md`——评估者从磁盘读取它们，记分板是与之相邻的一份 YAML。
- **配置。** `penguin config model add` 写入一份隐藏的项目配置文件。它只由 CLI 管理、从不手工编辑，而且你指到哪它就待在哪。

**确实会经过网络的部分：** 安装包与权重，方向是**进来**。`ollama pull`、`pip install vllm`、克隆 LlamaFactory、解析一个 Hugging Face 基座模型 ID——这些都是下载，没有一项在上传你的数据。方向值得说清楚，因为「本地」这个词经常被悄悄安在会回传的方案上。

**以及决定其余一切的那一项：** 驱动 Agent 的模型本身。如果 Agent 跑在托管 API 上，那么无论它调优的模型多本地，对话本身——你的指令、它读到的文件内容、它转述的工具输出——都会到达那家厂商。完全本地是你主动做的选择：用同样的 `penguin config model add ... --set-default`，把 Harness 自身的默认模型也指向本地端点，整个闭环就没有第三方参与。这是一个真实的取舍——让一个小的本地模型驱动整个闭环，和让一个前沿模型驱动它，不是同一件事——它应该是一个决定，而不是一个默认假设。

还有一个相关习惯值得保持，它在 `penguin-cli` 与 `penguin-sdk` 里都是硬性规则：**你正在开发的应用**的模型与 Key，属于该应用项目内自己的数据目录（`--root ./penguin_data`），绝不能写进全局 `~/.penguin/data`——那属于运行 Penguin 的人。开发期间两边都看一眼：应用的列表里应该有你的条目，全局列表应该保持干净。

## 真正改变的是什么

在这个版本之前，PenguinHarness 可以对接任何 OpenAI 兼容端点，但对这个端点从哪来只字不提。把模型部署起来、衡量它能做到什么、修补它做不到的地方，是三套工具、三套约定，中间夹着一个人做翻译。

现在它们是同一套系统，而人的位置变了。你描述你要的结果。Agent 自己部署模型、自己跑评测、自己读失败原因、自己微调、自己重新部署、自己再测一次——每一步都由上一步的结果决定。你负责批准调用、做判断、看记分板。

跑在你自己的硬件上。用你自己的权重。数据留在你放它的地方。

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```
