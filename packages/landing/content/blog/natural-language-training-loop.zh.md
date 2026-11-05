---
title: "让 Agent 用 Ollama、vLLM 和 LlamaFactory 部署、评估并微调本地模型"
date: 2026-07-22
category: practice
excerpt: "让 PenguinHarness 的 Agent 用 Ollama 或 vLLM 部署模型，用 Benchmark 衡量效果，再用 LlamaFactory 微调，然后重新衡量。你只需写两条请求、审批工具调用、提供训练数据；如果驱动 Agent 的也是本地模型，数据就始终不离开你的环境。"
---

> 本文基于 PenguinHarness 0.1.1 撰写，之后的版本在部分细节上可能有所不同。

PenguinHarness 0.1.1 新增了三个 Skill：`ollama`、`vllm` 和 `llamafactory`，用来在你自己的硬件上部署和微调模型。它们并不意味着你又要多学三个命令行工具。这三个 Skill 是写给 Agent 的，目的正是让你不必再亲手敲这些命令。你用一句话说出想要什么，Agent 就会选好工具，把该问的问题问清楚，执行命令，确认命令生效，再告诉你结果。

在这篇教程里，你会用它们在自己的硬件上跑通一个训练闭环。你给 Agent 发两条消息：第一条让它部署模型，第二条让它把模型微调到能通过评估为止。Agent 会部署模型，创建 Benchmark 并测出基线，用你指定的训练数据微调模型，重新部署，再测一次。你只需回答它的问题、审批它的工具调用、提供训练数据、查看记分板。文中出现的命令都是 Agent 执行过的，不是留给你照做的清单。

本教程适合想在自己的硬件上部署、评估和微调模型，又希望数据留在原处的人。做完之后，基座模型和微调后的模型都已注册，并在同一张记分板上对比。如果驱动 Agent 的也是本地模型（见第三步），你的数据就始终不会离开你的环境。

文中 Agent 的每一种行为，都写在 PenguinHarness 自带的某个 Skill 里。Skill 就是普通的 Markdown 文件，0.1.1 里放在 `packages/skills/skills/` 下，发请求之前，你就能先读到 Agent 会怎么做。Skill 管不到、需要你接手的地方，教程会明确指出。

你即将跑通的闭环如下：

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

## 准备工作

- PenguinHarness。本教程对应 0.1.1，也就是新增 `ollama`、`vllm` 和 `llamafactory` 三个 Skill 的版本。之后的版本把 Skill 挪进了插件，也改过一些名称和参数取值，所以新版本在细节上会有出入；Agent 始终按你所装版本自带的 Skill 行事。
- 一个供 Agent 自身运行的模型。托管 API 或本地模型都可以，两者的区别见第三步。
- 一台用来部署模型的机器。Ollama 是简单的默认选择，也是 macOS 或纯 CPU 机器上的唯一选项；vLLM 适合在 GPU 上做高吞吐部署。
- 一块用于 LlamaFactory 微调的 GPU。LoRA 需要的显存远少于全量微调。
- 网络连接，用来下载安装包和模型权重。部署、训练和评估都不会上传你的数据，唯一的例外是驱动 Agent 的模型，见第三步。

## 第一步：安装 PenguinHarness 并打开 Web App

安装 PenguinHarness 并启动 Web App：

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```

`penguin web` 会在浏览器里打开 Web App。第一次使用时，以内置管理员身份登录：0.1.1 的登录页上写着初始密码，之后的版本则改为在终端里打印一个一次性登录链接。如果还没有配置供 Agent 运行的模型，先在模型页添加，并把它设为默认模型。

点击**新对话**，再把这个对话的审批模式设为**总是询问**。新对话默认会自动放行所有工具调用；设为**总是询问**之后，每个工具调用都要等你点**允许**或**拒绝**，你在这篇教程里就是这样参与闭环的。下一步的请求就在这个对话里发送。

## 第二步：让 Agent 部署本地模型

发送这条消息：

> 在这台机器上跑一个本地模型，数据不要出去

这句话就是全部输入。Agent 加载 `ollama` Skill，接下来的事由它完成：

1. 动手之前先问两个问题，因为 Skill 规定目标不清楚时不许执行任何命令。第一个问题是跑哪个模型：如果你没有偏好，它会推荐一个小的默认模型 Qwen3.5-0.8B，并提醒你模型必须装得进机器的内存或显存。第二个问题是用哪个引擎：Ollama 是简单的默认选择，也是 macOS 或纯 CPU 机器上的唯一选项；vLLM 面向 GPU 上的高吞吐部署。这个选择由你来定。
2. 检查当前状态。Ollama 装了没有？是不是已经有服务在运行？如果 11434 端口上已经有实例，Agent 会复用它，绝不杀掉。0.1.1 的默认系统提示词里也写着同样的规则：绝不杀死不是自己启动的进程，端口被占用就换一个。
3. 缺 Ollama 就安装，然后拉取模型、调大上下文窗口。调大窗口这一步最常被跳过，结果往往要花一个下午排查：Ollama 的默认窗口很小，而 Agent 会话需要的上下文很大。Skill 给了两种调大的办法：在服务的环境变量里设置 `OLLAMA_CONTEXT_LENGTH`，或者用 Modelfile 把 `num_ctx` 固化成一个模型变体。
4. 先验证端点，再注册模型。拉取下来的模型要添加之后，PenguinHarness 才看得到，而模型配置归 CLI 管：

   ```bash
   # 这是 Agent 执行过的命令，不是给你照做的清单
   curl http://localhost:11434/v1/models

   penguin config model add --provider custom --client-type openai \
     --base-url http://localhost:11434/v1 --model-id qwen3.5:0.8b --api-key ollama
   penguin config model list
   ```

这些命令一条都不用你来跑。你只需回答那两个问题，并在每个工具调用出现时点**允许**或**拒绝**；调用之所以会停下来等你，靠的正是第一步设置的审批模式。在 SDK 里，这道审批关卡是一个回调函数，应用如果不提供它，所有工具调用都会被拒绝。

### 注册命令各部分的含义

这条命令里的每个细节都有讲究，Agent 是从 `penguin-cli` Skill 里学到的：

- PenguinHarness 里的模型由 `(provider, model_id)` 二元组确定，分组绝不从模型 id 推断。网关会用上游 id 转售厂商的模型，一旦猜错，你的 API Key 可能被发到别人的端点上。内置分组之外的任何端点，都归入 `custom` 分组。
- 任何兼容 OpenAI chat completion 接口的服务，都用 `--client-type openai --base-url <endpoint>` 这种写法。
- `--api-key ollama` 不是摆设：Ollama 接受任意 Key，但这个字段不能为空。

这个 Skill 还讲了两个这条命令没有用到的参数：

- `--max-tokens` 是 0.1.1 新增的单模型输出上限，会覆盖 Agent 默认的 32,000。这个默认值再加上任何提示词，都放不进 32k 的窗口，所以本地模型的上下文窗口较小时，Agent 有理由设置它。
- `--root` 决定注册到哪个数据根目录。Agent 在开发应用时，`--root` 必须指向应用自己的数据目录（`--root ./penguin_data`，也就是应用传给 `createAgent({ root })` 的那个路径）。默认根目录留给 PenguinHarness 自身运行所用的模型，本教程注册的也正是这里。注册到正确的位置，闭环才能合上：Agent 刚部署好的模型，成了它自己接下来就能用的模型。

## 第三步（可选）：让整个闭环留在本地

从下一步开始，Agent 就要接触你的数据了：它会读评估题目、Trace 和你的训练数据。这些内容会不会离开你的机器，取决于一个选择：驱动 Agent 的模型。如果 Agent 跑在托管 API 上，那么即使它微调的模型完全在本地，对话本身也会发到那家供应商，包括你的指令、Agent 读到的文件内容和它转述的工具输出。

要让一切都留在本机，就把 Agent 刚部署好的端点也设为 PenguinHarness 自身的默认模型：还是那条 `penguin config model add ...` 命令，加上 `--set-default`。可以让 Agent 来执行，也可以自己执行。在 0.1.1 里，一个对话会一直使用它开始时的模型，所以第四步的请求要在新对话里发送，并写明你部署的是哪个模型，因为新对话不知道第二步里发生了什么。这样整个闭环从头到尾都没有第三方参与。

这是一个实实在在的取舍：由小型本地模型驱动整个闭环，和由前沿模型来驱动，完全是两回事。要不要这样做，应该是你想清楚之后的决定，而不是默认如此。

## 第四步：让 Agent 微调模型，直到通过评估

发送第二条消息：

> 把这个模型微调到能过我的评估

这句话让闭环合上，关键在「评估」两个字：没有数字就谈不上改进，而只跑一次也算不上数字。所以 Agent 先用 `benchmark-design` Skill 把测量搭起来：

- 它规划出一个 Benchmark：一组题目，每道题都有被测 Agent 能看到的公开题干，以及它绝不能看到的私有评分细则，外加记录结果的记分板。
- 它需要知道被测 Agent 和要测量的能力，缺哪一项就向你询问哪一项。
- 每道题默认运行不止一次，因为对不确定的本地模型只采样一次，算不上测量。
- `agent-evaluation` Skill 隔离执行每道题的每次运行，只返回协议元数据：分数、成本、耗时和 Session id。评分细则正是这样被挡在被测 Agent 的上下文之外。

这样 Agent 拿到的就不只是一个数字。每次评估都记录产生它的 `(provider, model_id)` 二元组，基座模型和微调后的模型因此落在同一张记分板上，可以直接对比。每次运行都带着 Session id，Agent 可以打开对应的 Trace，看清是哪一步丢了分。「针对做错的地方微调」这句话，因此有了具体的所指。

## 第五步：提供训练数据，用 LlamaFactory 微调

训练开始前，`llamafactory` Skill 要求 Agent 跟你确认四件事：

- 可用显存（LoRA 需要的显存远少于全量微调）；
- 基座模型；
- 数据集及其格式；
- 训练目标，通常从 LoRA SFT 起步。

数据集要由你来提供。把失败的 Trace 变成训练样本，是唯一一个没有 Skill 规定做法的环节：`llamafactory` Skill 只问你数据集放在哪、是什么格式，并不教 Agent 怎样从 Trace 里整理出 SFT 数据。把数据集的位置告诉 Agent。如果想把失败的 Trace 变成训练数据，可以让 Agent 写转换脚本：它能读 Trace，也能写脚本，但这是你在指挥它，不是 Skill 在驱动它。

随后，Agent 把数据集按 alpaca 或 sharegpt 格式登记到 `data/dataset_info.json`，参照 LlamaFactory 随附的 `examples/train_lora/qwen3_lora_sft.yaml` 写出训练配置，执行 `llamafactory-cli train`，并先交互试用训练结果，确认可信再使用。

## 第六步：重新部署，再测一次

Agent 把适配器合并进基座权重并导出。vLLM 可以直接部署导出目录，Ollama 则需要先导入。用 vLLM 部署导出结果时，`vllm` Skill 早就告诉过 Agent 那对人人都会忘的参数：`--enable-auto-tool-choice`，以及与模型系列匹配的 `--tool-call-parser`。

Agent 把微调后的端点注册成独立的模型 id，不覆盖基座模型，这样两者都留在记分板上。然后同一个 Benchmark 再跑一遍，你在记分板上对比两次的结果。从部署到再测一次，没有哪一步需要你说出一条命令。

如果想改进的是 Agent 本身而不是模型权重，可以用 `agent-optimization` Skill，它基于同一张记分板工作。在有可供回滚的快照之前，它不会改动 Agent State。

## 各环节如何衔接

Agent 能跑通这个闭环，靠的是下面三点，每一点背后都有一个你能打开查看的文件。

### 知识已经装在 Agent 里

在 0.1.1 里，`packages/skills/skills/vllm/SKILL.md`、`.../ollama/SKILL.md` 和 `.../llamafactory/SKILL.md` 都属于 Skill 库，而 Project 的 `default_agent` 在创建时就装好了整个库。下载、配置、粘贴，这些都不用你做。负责测量和改进的 `benchmark-design`、`agent-evaluation` 和 `agent-optimization` 也在同一个库里，安装方式相同。全新安装之后，Agent 就已经知道：启动 vLLM 必须带上 `--enable-auto-tool-choice` 和与模型系列匹配的 `--tool-call-parser`，否则每次工具调用都会返回 `400`；Ollama 默认的上下文窗口装不下 Agent 会话，以及调大窗口的两种办法；LoRA 适配器绝不能合并进量化过的基座。这些细节，往往要搭进去一个下午才会弄明白。

### 会用的工具再多，每次请求也几乎不增加开销

Skill 没有专用工具，也不会整篇塞进提示词。系统提示词模板里有一个 `{{SKILL_METADATA}}` 占位符，组装时会替换成每个已安装 Skill 各一行的元数据，例如 `` - `vllm` — Deploy and serve LLMs with vLLM behind an OpenAI-compatible endpoint… ``。只有任务对得上时，Agent 才用 shell 命令从磁盘读取 Skill 正文。在 0.1.1 里，15 个 Skill 的元数据行合计约 2.5 KB，正文合计超过 100 KB，用到之前一个字都不进上下文窗口。

### Agent 操作的是真正的 CLI

在 0.1.1 里，会话的内置工具是 `exec_command`、`input_command`、`run_subagent`、`input_subagent` 和一个图像工具。没有读文件工具，没有写文件工具，也没有针对某家厂商的集成：`exec_command` 自己的描述就告诉模型，用 shell 读写、编辑文件和运行程序。所以 `vllm serve`、`ollama pull` 和 `llamafactory-cli train` 都不需要适配层，Skill 里写的参数就是这些工具真正的参数；vLLM 哪天加了新参数，改一份 Markdown 就行，不必等 Harness 发新版。闭环能留在本地也是这个原因：Agent 直接在存放数据的机器上执行命令，中间没有一个需要先看到你数据集的托管控制面。

换成别的有 shell 可用、能力足够的 Agent，给它同样的指令，也能做到这些。区别在于，PenguinHarness 已经装好了这些指令，只占约 2.5 KB 的提示词，其中还包括注册这一步，有了它，部署好的模型才真正用得上。换作别处，这些都得你自己知道，而且每个会话都要再来一遍。

## 故障排查

下面这些故障的处理办法已经写进 Skill，Agent 知道怎么应对。列在这里，是为了让你在会话中遇到时能认出来：

- vLLM 拒绝所有工具调用：启动服务时没有带工具调用参数。用 `vllm serve <model> --enable-auto-tool-choice --tool-call-parser hermes` 重新启动，并按模型系列选择 parser（Qwen 用 `hermes`，Llama 用 `llama3_json`）。不带这对参数，Agent 的每个请求都会报 `400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set`。
- vLLM 启动时显存不足：调低 `--gpu-memory-utilization` 或 `--max-model-len`，或者改为部署量化模型。
- Ollama 的上下文窗口太小：用 `OLLAMA_CONTEXT_LENGTH=32768 ollama serve` 启动服务，或者在 Modelfile 里写上 `PARAMETER num_ctx 32768`，再执行 `ollama create`。
- Ollama 已经在运行：11434 端口被占用，说明应该复用现有实例，绝不能杀掉不是自己启动的服务进程。
- 合并 LoRA 适配器：为了独立部署，要把适配器合并进基座权重，但绝不能合并到量化过的基座上。
- 部署好的模型在 PenguinHarness 里看不到：模型添加之前一直不可见，用 `--provider custom --client-type openai --base-url <endpoint>` 注册即可。

还有一个错误出在 Harness 本身，而不在 Skill 里。0.1.1 之前，不带工具的请求也会发送一个空的工具列表，vLLM 会以 `400 … tools must not be an empty array` 拒绝；0.1.1 不再发送空列表，升级即可解决。

## 哪些东西留在本机

在这套配置下，以下内容都留在本地：

- 部署的模型。Ollama 在 `http://localhost:11434/v1` 提供 OpenAI 兼容 API，vLLM 在 `http://localhost:8000/v1`。Agent 会话里发给它们的每条提示词、工具 Schema、工具结果和补全，都只经过本机回环接口。
- 训练。LlamaFactory 跑在你的 GPU 上。数据集放在 `data/` 下，与 `data/dataset_info.json` 相邻；适配器和合并后的导出结果落在 `saves/` 下。`llamafactory-cli train` 的任何阶段都不会把你的样本发出去。
- 评估。题目、题干和评分细则都是你 Project 里的文件，评估者从磁盘读取它们。一份评分细则的路径形如 `~/.penguin/data/default_project/agents/tool_router/benchmarks/tool-routing-v1/CASE-003-pick-the-cheaper-endpoint/rubric/README.md`，记分板是它们旁边的一个 YAML 文件。
- 配置。`penguin config model add` 写入一个隐藏的 Project 配置文件。它只由 CLI 管理，不应手工编辑，你指定放在哪里，它就留在哪里。

如果驱动 Agent 的是本地模型，经过网络的就只有安装包和模型权重，而且都是下载进来。`ollama pull`、`pip install vllm`、克隆 LlamaFactory、解析 Hugging Face 基座模型 id，这些都是下载，没有一项会上传你的数据。如果驱动 Agent 的是托管模型，对话本身也会发到那家供应商，见第三步。

## 结语

在 0.1.1 之前，PenguinHarness 能对接任何 OpenAI 兼容端点，却不管这个端点从哪里来。把端点搭起来、测出它能做什么、补上它做不到的，要用三套工具、守三套约定，中间还得有个人来回转述。

在这篇教程里，你只描述了两个目标。Agent 自己部署模型、跑 Benchmark、读失败原因、微调、重新部署、再测一次，每一步都由上一步的结果决定。你留在闭环里的位置有三处：审批工具调用；做判断（选哪个基座模型、用哪个引擎、多好才算够好）；提供训练数据。其余的一切，从参数、端口、parser，到要不要复用正在运行的服务，都写在 Skill 里，也就是都装在 Agent 身上。

接下来可以：

- 到 [`packages/skills/skills/`](https://github.com/Prism-Shadow/penguin-harness/tree/v0.1.1/packages/skills/skills) 读一读 0.1.1 随附的 Skill，看看 Agent 手里都有哪些知识。
- 如果这次驱动 Agent 的是托管模型，可以按第三步的做法，换成本地模型再跑一遍闭环。
