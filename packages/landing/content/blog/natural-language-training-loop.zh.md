---
title: 让 Agent 来操作 Ollama、vLLM、LlamaFactory，做数据安全的模型训练自闭环
date: 2026-07-22
category: practice
excerpt: PenguinHarness 0.1.1 新增了 ollama、vllm、llamafactory 三个技能。它们不是三个要你去学的命令行工具，而是 Agent 本来就会的东西——于是「在这里部署一个模型，再把它微调到能过我的评测」变成了你说的一句话，而不是你敲的一串命令。本文主要讲的是：为什么这套 Harness 能把这三个工具用好——什么是开箱就有的、每次请求要付多少代价、以及闭环凭什么合得上。而整个过程中的数据不出你自己的环境。
---

0.1.1 带来了三个技能：`ollama`、`vllm`、`llamafactory`。最容易的误读是：PenguinHarness 现在要你再学三个命令行工具。

恰恰相反。这些技能不是写给你的，是写给 Agent 的；它们存在的全部理由，就是让你不再敲这些命令。你用一句话说清楚要什么，Agent 自己选工具、问该问的问题、执行、验证，然后把结果讲给你听。

本文分三部分：

1. **接口是一句话。** 你输入什么，Agent 随后自己做了什么。
2. **为什么这套 Harness 能把这三个工具用得更好。** 六件写在仓库文件里、而不是留在你脑子里的事。
3. **闭环合得上，而且数据不出域。** 部署 → 评测 → 微调 → 重新部署 → 再测一次，跑在你自己的硬件与权重上。

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

## 二、为什么这套 Harness 能把这三个工具用好

任何一个有 Shell 的能干 Agent，原则上都跑得动 `vllm serve`。真正的问题是：从「原则上可以」到「这一次会话第一遍就跑通」，中间要补多少东西，而其中又有多少得由你来补。下面六条回答，每一条对应仓库里的一个文件，而不是一个形容词。

**其一：这些知识是开箱就有的。** `packages/skills/skills/vllm/SKILL.md`、`.../ollama/SKILL.md`、`.../llamafactory/SKILL.md` 本身就属于技能库，而一个项目的 `default_agent` 在创建时会把整个技能库装上——不用去拉取、不用去配置，也不用你粘贴进去。所以在一台全新安装的机器上，Agent 已经知道：vLLM 必须带上 `--enable-auto-tool-choice` 和与模型家族匹配的 `--tool-call-parser` 启动，否则每一次工具调用都会返回 `400`；Ollama 的默认上下文窗口撑不住 Agent 会话，以及两种调大它的办法；LoRA 适配器绝不能合并到量化过的基座上。这些都不算冷门知识——它们恰好就是那种「搭进去一个下午才会知道」的知识。

<details>
<summary><strong>展开：三个技能里已经写着的一部分坑</strong></summary>

以下直接来自已发布的 `SKILL.md`——这就是在你开口之前，Agent 就已经能够拿到的细节：

- **vLLM 的工具调用。** `vllm serve <model> --enable-auto-tool-choice --tool-call-parser hermes`，parser 按模型家族选（Qwen 用 `hermes`，Llama 用 `llama3_json`）。不带它，每一次 Agent 请求都会得到 `400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set`。
- **vLLM 启动时显存不足。** 调低 `--gpu-memory-utilization` 或 `--max-model-len`，或者改部署量化模型。
- **Ollama 的上下文。** `OLLAMA_CONTEXT_LENGTH=32768 ollama serve`，或在 Modelfile 里写 `PARAMETER num_ctx 32768` 再 `ollama create`。
- **Ollama 已经在跑。** 11434 端口被占就复用——绝不杀死一个不是自己启动的服务进程。
- **LlamaFactory 的合并。** 为了能独立部署要把适配器合并进基座权重，但绝不合并到量化过的基座上。
- **把结果注册回去。** `--provider custom --client-type openai --base-url <endpoint>`；模型部署起来之后，不添加就对 Penguin 不可见。

</details>

**其二：会用很多工具，几乎不增加每次请求的开销。** 技能没有专门的工具，也不会被整段拼进提示词。系统提示词模板里只有一个 `{{SKILL_METADATA}}` 占位符，装配时把它替换成每个已安装技能一行的元数据——形如 `` - `vllm` — Deploy and serve LLMs with vLLM behind an OpenAI-compatible endpoint… ``——而技能正文要等任务真的对上了，才由模型用 Shell 命令从磁盘读进来。在 0.1.1 里，这是十五个技能、元数据合计约 2.5 KB，而它们的正文合计超过 100 KB，在被需要之前一个字都不进上下文窗口。对一个这一轮用不上的工具了解得很深，并不需要你每次请求都为它付费。

**其三：它操作的就是真正的 CLI，因为它手里只有这个。** 一次会话的内置工具是 `exec_command`、`input_command`、`run_subagent`、`input_subagent`，外加一个图像工具。没有读文件工具，没有写文件工具，也没有任何按厂商定制的集成：`exec_command` 自己的描述就是让模型用 Shell 去读写编辑文件、运行程序。这个约束在这里恰恰是优点。`vllm serve`、`ollama pull`、`llamafactory-cli train` 不需要谁去写一层适配，技能里写的参数就是工具真正的参数，而不是某层封装挑出来的子集；等 vLLM 下个月加了新参数，要改的是一份 Markdown，而不是发一个 Harness 的新版本。

**其四：闭环合得上，是因为「注册」本身就是工作的一部分。** 把模型部署起来，和**能用上**这个模型，是两件事；而大多数「Agent 帮我搭好了」的演示，正是在这条缝上悄悄结束的。`penguin-cli` 技能把它补上了：它告诉 Agent，端点在 `penguin config model add` 注册之前是不可见的；更关键的是，要注册到**哪个**数据根目录里。Agent 在开发一个应用时，`--root` 必须指向该应用项目内自己的数据目录（`--root ./penguin_data`，也就是应用传给 `createAgent({ root })` 的那个路径），而默认根目录是留给 Penguin 自身的模型的。于是它刚刚部署好的模型，就成了它接下来可以运行其上的模型——有意为之，且落在正确的位置。演示和闭环的差别就在这里。

**其五：「能衡量」是随包发布的能力，不是留给读者的练习。** `benchmark-design`、`agent-evaluation`、`agent-optimization` 在同一个技能库里，用同样的方式安装。执行不等于改进；「微调到能过」这句话，得先有个东西能说出「过了」。第三部分讲的就是这三个技能做了什么。

**其六：这两个故事其实是同一个故事。** Agent 之所以能驱动这些工具，正是因为它是在持有数据的那台机器上直接执行命令。中间没有一个托管的控制面，需要先看到你的数据集才能编排这次运行。「本地」不是给这套设计外挂上去的特性，它和「它能用真正的 CLI」是同一件事。

**以及这六条的诚实版本。** 以上没有一条是在说别的 Agent 做不到。把同样的说明喂给任何一个会用 Shell 的强 Agent，它也能把模型部署起来。差别比一句「最强」小得多，也更可核查：在 PenguinHarness 上，这些说明是已经装好的，代价是约 2.5 KB 的提示词，而且其中包含了那一步让模型在部署之后真正可用的注册。换到别处，得由你来知道这些——并且下一次会话还得再知道一遍。

## 三、「把这个模型微调到能过我的评测」

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

**Agent 先把量具造出来。** `benchmark-design` 让它铺开一个 Benchmark：一组 Case，每个 Case 都有被测 Agent 能看到的公开 Statement 和它绝不能看到的私有 Rubric，以及结果落地的记分板。每个 Case 默认不止跑一次——对一个不确定的本地模型采样一次，算不上一次测量。`agent-evaluation` 负责隔离地执行每一次 Case 运行，且只返回协议元数据：分数、成本、耗时、session id。正是这份沉默让 Rubric 不进入被测 Agent 的上下文。

**于是 Agent 拿到的不只是一个数字。** 每次评估都记录产生它的 `(provider, model_id)` 二元组，基座模型与调优后的后继者因此落在同一张记分板上，可以直接比。而每一次 run 都带着自己的 session id，Agent 可以打开那次 Trace，看清是哪一步丢的分。「针对失分微调」这句话之所以有确切的所指，全靠这一点。

**然后它开始微调。** `llamafactory` 技能要求它在训练前确认四件事：可用显存（LoRA 的需求远低于全参微调）、基座模型、数据集及其格式、以及目标——常规起点是 LoRA SFT。它把数据集按 alpaca 或 sharegpt 格式登记进 `data/dataset_info.json`，从随附的 `examples/train_lora/qwen3_lora_sft.yaml` 派生出训练配置，执行 `llamafactory-cli train`，并在信任结果之前先交互试一下。

**然后它重新部署，再测一次。** 适配器被合并进基座权重并导出。vLLM 可以直接部署导出目录，Ollama 则需要先导入。部署时，`vllm` 技能早就告诉过它那个所有人都会忘的参数——就是第二部分里那对工具调用开关。调优后的端点被注册成**独立**的模型 ID，而不是覆盖基座——正是为了让两者都留在记分板上——然后同一个 Benchmark 再跑一遍。

这就是闭环，而从「部署」到「再测一次」之间的每一步，都不需要你说出任何一条命令。

**有一道缝，明说。** 把失败的 Trace 变成训练样本，是技能**没有**规定的一步。`llamafactory` 只问你数据集在哪、是什么格式，它并不教 Agent 如何从 Trace 里挖出一份 SFT 数据。Agent 能读 Trace，你让它写转换脚本它也能写——但那是你在指挥它，不是技能在驱动它。谁要是告诉你这一段已经全自动了，那多半是在卖东西。

## 四、人还站在哪里

三个位置，都不是疏漏：

- **批准工具调用。** 每一次工具调用都要过闸。在 SDK 里这个闸就是一个回调函数，不提供它等于全部拒绝——默认是拒绝，而不是放行。
- **只能由你做的判断。** 用哪个基座模型、用哪个引擎、多好才算「够好」。三个部署与调优技能都写成**先问**而不是替你假设；`benchmark-design` 也要求你先指明被测 Agent 与要衡量的能力才肯开始。如果你想改进的是 Agent 本身而不是权重，`agent-optimization` 基于同一张记分板工作——而且在存在可回滚的快照之前，它拒绝改动 Agent State。
- **数据集那道缝**，见第三部分结尾。

除此之外的一切——用哪些参数、哪个端口、哪个 parser、要不要复用已在运行的服务、遇到 `400 … tools must not be an empty array` 怎么办（升级到 0.1.1，它不再发送空工具列表）、vLLM 启动显存不足怎么办——都写在技能里，也就意味着都在 Agent 身上。

## 五、数据安全不出域

这才是整套安排值得折腾的理由，所以它需要的是精确，而不是口号。

**这套配置下留在本地的部分：**

- **被部署的模型。** Ollama 在 `http://localhost:11434/v1` 暴露 OpenAI 兼容 API，vLLM 在 `http://localhost:8000/v1`。两者都在本机。对它们发起的 Agent 会话里，每一条提示词、工具 Schema、工具结果与补全，都留在本地回环接口上。
- **训练。** LlamaFactory 跑在你自己的 GPU 上。数据集放在 `data/` 下、与 `data/dataset_info.json` 相邻；适配器与合并后的导出落在 `saves/`。`llamafactory-cli train` 的任何阶段都不会把你的样本发出去。
- **评测。** Case、Statement 与 Rubric 都是你项目里的文件——一份 Rubric 的路径形如 `~/.penguin/data/default_project/agents/tool-router/benchmarks/tool-routing-v1/CASE-003-pick-the-cheaper-endpoint/rubric/README.md`——评估者从磁盘读取它们，记分板是与之相邻的一份 YAML。
- **配置。** `penguin config model add` 写入一份隐藏的项目配置文件。它只由 CLI 管理、从不手工编辑，而且你指到哪它就待在哪。

**确实会经过网络的部分：** 安装包与权重，方向是**进来**。`ollama pull`、`pip install vllm`、克隆 LlamaFactory、解析一个 Hugging Face 基座模型 ID——这些都是下载，没有一项在上传你的数据。方向值得说清楚，因为「本地」这个词经常被悄悄安在会回传的方案上。

**以及决定其余一切的那一项：** 驱动 Agent 的模型本身。如果 Agent 跑在托管 API 上，那么无论它调优的模型多本地，对话本身——你的指令、它读到的文件内容、它转述的工具输出——都会到达那家厂商。完全本地是你主动做的选择：用同样的 `penguin config model add ... --set-default`，把 Harness 自身的默认模型也指向本地端点，整个闭环就没有第三方参与。这是一个真实的取舍——让一个小的本地模型驱动整个闭环，和让一个前沿模型驱动它，不是同一件事——它应该是一个决定，而不是一个默认假设。

## 真正改变的是什么

在这个版本之前，PenguinHarness 可以对接任何 OpenAI 兼容端点，但对这个端点从哪来只字不提。把模型部署起来、衡量它能做到什么、修补它做不到的地方，是三套工具、三套约定，中间夹着一个人做翻译。

现在它们是同一套系统，而人的位置变了。你描述你要的结果。Agent 自己部署模型、自己跑评测、自己读失败原因、自己微调、自己重新部署、自己再测一次——每一步都由上一步的结果决定。你负责批准调用、做判断、看记分板。

跑在你自己的硬件上。用你自己的权重。数据留在你放它的地方。

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```
