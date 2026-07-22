---
title: 部署、评测、微调、再评测：实践新的 Ollama、vLLM 与 LlamaFactory 技能
date: 2026-07-22
category: practice
excerpt: PenguinHarness 0.1.1 新增三个技能，让 Agent 能把自己运行所依赖的模型部署起来、调优出来。本文讲怎么用——用 Ollama 跑一个数据不出本机的私有模型，以及用 vLLM 部署、评测 Agent、用 LlamaFactory 针对失分微调、再部署再评测，把调优闭环合上。
---

在这个版本之前，PenguinHarness 可以对接任何 OpenAI 兼容端点，但对这个端点从哪来只字不提。**0.1.1 用三个新技能补上了这一段**：`ollama` 与 `vllm` 负责把模型部署起来，`llamafactory` 负责把它调优。加上负责注册结果的 `penguin-cli` 技能，Agent 现在可以掌握从原始权重到一个可比较分数的完整链路。

本文走一遍这条链路上大家真正想要的两件事：

1. **一个数据不出本机的本地模型。** Ollama 跑在自己机器上，一条命令接进 PenguinHarness。
2. **一个调优闭环。** vLLM 部署 → Agent 运行并被打分 → LlamaFactory 针对失分微调 → 部署调优后的权重 → 再测一次。

下文每一条命令都来自已发布的技能本身——你可以自己读 `packages/skills/skills/{ollama,vllm,llamafactory,penguin-cli}/SKILL.md`，或者直接让 Agent 按名字调用这些技能。

## 第一部分——用 Ollama 跑一个私有本地模型

思路很简单：Ollama 在本地运行开源权重模型，自动识别 GPU，并在 `http://localhost:11434` 上暴露一个 OpenAI 兼容 API；而 PenguinHarness 本来就对接 OpenAI 兼容端点。于是整条链路——提示词、推理、工具调用、执行结果——全部留在本机，没有任何一个 Token 越过你自己掌控之外的网络边界。

### 先看清楚现在跑着什么

技能的第一条规则，在做任何事之前：先看，再动。

```bash
ollama --version   # 是否已安装 Ollama？
ollama ps          # 服务是否已经在提供模型？
```

如果 11434 端口已经在服务，复用那个实例——绝不要杀掉已有的 Ollama 进程。（这也正是 0.1.1 写进默认系统提示词的直觉：绝不杀死不是自己启动的进程；端口被占就另选一个。）

### 安装并拉取模型

```bash
curl -fsSL https://ollama.com/install.sh | sh   # Linux；macOS/Windows 使用桌面版
ollama pull qwen3.5:0.8b
```

在你没有特别偏好时，技能推荐的就是 `qwen3.5:0.8b`——足够小，几乎哪里都放得下。这一点很重要：模型必须装得进机器的内存或显存。硬件允许的话，换成更大的模型即可。

### 给它一个够用的上下文窗口

这一步最容易被跳过，然后花一个下午排查。Ollama 默认的上下文窗口很小，而 Agent 会话不是。在服务的环境变量里调大：

```bash
OLLAMA_CONTEXT_LENGTH=32768 ollama serve   # systemd 服务：用 `systemctl edit ollama` 设置
```

或者用 Modelfile 固化成一个模型变体：

```
FROM qwen3.5:0.8b
PARAMETER num_ctx 32768
```

```bash
ollama create qwen3.5-32k -f Modelfile
```

### 先验证，再注册

端点是 `http://localhost:11434/v1`，任何非空 API Key 都被接受，惯例上填 `ollama`：

```bash
curl http://localhost:11434/v1/models
```

拉取下来的 Ollama 模型在你添加之前，对 PenguinHarness 是不可见的。模型配置是 CLI 的职责：

```bash
penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 --model-id qwen3.5:0.8b --api-key ollama
penguin config model list   # 新条目现在应该出现在列表里
```

这条命令里有三处值得理解，而不是照抄：

- `--provider custom` 是**必填**的。PenguinHarness 里的模型由 `(provider, model_id)` 二元组确定，分组永远不从模型 ID 推断——网关会用上游 ID 转售厂商模型，猜错就意味着把你的 Key 发到别人的端点上。`custom` 是内置分组之外任何端点所属的分组。
- `--client-type openai --base-url <endpoint>` 是所有 OpenAI chat-completion 兼容服务的写法。只有当你希望按模型 ID 自动路由时才省略 `--client-type`，而本地模型 ID 是没有自动路由的。
- `--api-key ollama` 不是装饰。Ollama 接受任何非空 Key，但这个字段必须非空。

然后跑一个任务：

```bash
penguin run -m "总结当前目录下的 README" \
  --provider custom --model-id qwen3.5:0.8b --approve allow-all
```

如果不想每次都带上这对参数，在 `model add` 时加 `--set-default`。另外，如果本地模型的上下文窗口很小，记得同时限制输出：`penguin config model add --max-tokens <n>` 设置的是模型级输出上限，优先级高于 Agent 默认值（32000）——而这个默认值本身就塞不进 32k 的上下文窗口，更别说再加上提示词。这个模型级上限是 0.1.1 新增的，起因正是「本地 32k 模型拒绝每一个请求」这种毫无帮助的失败方式。

### --root 规则

在继续之前有一条硬性规则值得先说清楚，它决定了你得到的是一个干净的项目，还是一个被污染的家目录：

- **为 PenguinHarness 自身配置模型**——用默认数据根目录，不带 `--root`。
- **为你正在开发的 AI 应用配置模型**——`--root` **必须**指向该应用项目内自己的数据目录（例如 `--root ./penguin_data`，与应用传给 `createAgent({ root })` 的路径一致），绝不能写进全局 `~/.penguin/data`：那属于运行 Penguin 的人，不属于你的应用。

开发应用期间要定期两边都看一眼：`penguin config model list --root ./penguin_data` 应当列出应用的条目，而不带参数的 `penguin config model list` 应当保持干净。

## 第二部分——用 vLLM 与 LlamaFactory 合上调优闭环

第一部分给你一个本地模型，第二部分给你一个*更好的*本地模型。闭环有四步，PenguinHarness 是中间那件量具：

```text
vLLM 部署基座模型
      ↓
Agent 运行，并按 Rubric 打分
      ↓
LlamaFactory 针对失分微调
      ↓
vLLM 部署调优后的权重 → 再测一次
```

下面的例子全程使用 `Qwen/Qwen3-1.7B`，也就是 LlamaFactory 随附示例配置里的基座模型——两半用同一个模型，训练用的 `template` 就是技能实际给出的那个值，而不是我替你猜的一个。

### 第一步——用 vLLM 部署基座模型

vLLM 需要 NVIDIA 或 AMD GPU（Ollama 更简单，也是 macOS 与纯 CPU 机器上的唯一选择；追求吞吐时选 vLLM）。先确认硬件：

```bash
nvidia-smi          # NVIDIA：型号与空闲显存（AMD ROCm 用 rocm-smi）
python3 --version
```

装进一个干净的虚拟环境，然后启动服务：

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install vllm
vllm serve Qwen/Qwen3-1.7B --port 8000 --api-key local-dev \
  --enable-auto-tool-choice --tool-call-parser hermes
```

**最后那两个参数不要省。** Agent Harness——包括 PenguinHarness——会在请求里带上 `tools`，而 vLLM 必须在启动时显式开启支持。不加这两个参数，带工具选择的请求会失败并返回 `400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set`。parser 按模型家族选：Qwen 用 `hermes`，Llama 用 `llama3_json`。

技能里还列了这些常用参数：`--served-model-name <name>`（客户端请求时用的模型 ID，默认是模型路径）、`--api-key <key>`（要求携带该 Bearer Token）、`--max-model-len <n>`（上下文窗口，Agent 会话需要大的）、`--gpu-memory-utilization <0..1>`（默认 0.9）、`--tensor-parallel-size <n>`，以及控制精度与量化权重的 `--dtype` / `--quantization`。端口被占就换一个空闲端口——绝不要杀掉正在监听的进程。

验证与注册跟上一节完全一样，只是端口和 ID 变了：

```bash
curl http://localhost:8000/v1/models

penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:8000/v1 --model-id Qwen/Qwen3-1.7B --api-key local-dev
penguin config model list
```

（`--model-id` 填 `--served-model-name` 报出的那个值，默认就是模型路径，这里即 `Qwen/Qwen3-1.7B`；`--api-key` 填你传给 `vllm serve --api-key` 的 Token。）

0.1.1 的一处修复让这一步比过去省心得多：严格的 OpenAI 兼容服务会拒绝携带 `tools: []` 的请求，vLLM 说得毫不客气——`400 … tools must not be an empty array. Either provide at least one tool or omit the field entirely.` PenguinHarness 所有不带工具的请求（Models 页面的连通性探测、会话标题生成、视觉描述）过去都会撞上它。现在列表为空时该字段被整个省略，vLLM 端点的行为与托管端点一致了。

### 第二步——跑 Agent，并给它打分

接下来测量你刚部署的模型。把一次运行指过去：

```bash
penguin run -m "<你的任务>" --provider custom --model-id Qwen/Qwen3-1.7B --approve allow-all
```

但凡是你打算*改进*的东西，跑一次都算不上测量。`benchmark-design` 技能会构建一个真正的评测：一个包含多个 Case 的 Benchmark 目录，每个 Case 有 Agent 能看到的公开 `statement/` 与它永远看不到的私有 `rubric/`，一个 `runs` 次数让不确定的本地模型被平均而不是只采样一次，以及一份持续累积结果的 `scoreboard.yaml`。`agent-evaluation` 技能则在隔离的 Workspace 里执行并评分恰好一个 Case，只返回协议元数据——正是这层隔离，让 Rubric 不会进入被测 Agent 的上下文。

让 Agent 使用 `benchmark-design`，它会把整个流程跑完。真正重要的是回来的东西：逐 Case 的分数，且这些分数记录在产生它们的 `(provider, model_id)` 二元组上——于是基座模型与调优后的后继者可以直接对比——并且每一次 run 都能直达自己的 Trace。你读到的不只是一个数字，你可以打开那次会话，看清是哪一步丢的分。

### 第三步——针对失分做微调

那些 Trace 就是你的数据集。模型答错的 Case、调错的工具、始终不遵守的格式——把它们变成训练样本。

安装 LlamaFactory：

```bash
git clone --depth 1 https://github.com/hiyouga/LlamaFactory.git
cd LlamaFactory
pip install -e .
pip install -r requirements/metrics.txt   # 可选：评估指标
```

注册数据集。每个数据集都必须在 `data/dataset_info.json` 中声明，数据文件与注册表一起放在 `data/` 下：

```json
"my_dataset": { "file_name": "my_dataset.json" }
```

支持 alpaca 与 sharegpt 两种格式——alpaca 每行是 `instruction` / `input` / `output`，sharegpt 每行是一个 `conversations` 列表。Agent 的多轮记录天然对应 sharegpt，单轮纠正对应 alpaca。

训练由一份 YAML 配置驱动。可以从随附的 `examples/train_lora/qwen3_lora_sft.yaml` 改，也可以写一份最小配置：

```yaml
model_name_or_path: Qwen/Qwen3-1.7B
trust_remote_code: true
stage: sft
do_train: true
finetuning_type: lora
lora_rank: 8
lora_target: all
dataset: my_dataset
template: qwen3
output_dir: saves/qwen3-1.7b/lora/sft
learning_rate: 1.0e-4
num_train_epochs: 3.0
bf16: true
```

```bash
llamafactory-cli train my_sft.yaml
```

LoRA SFT 是常规起点，显存需求远低于全参微调——选之前先看 `nvidia-smi`。想完全不写 YAML，`llamafactory-cli webui` 提供同一套流程的无代码界面。

部署之前先试一下：

```bash
llamafactory-cli chat my_infer.yaml   # 与调优后的模型交互对话
llamafactory-cli api my_infer.yaml    # 或者直接起一个带适配器的 OpenAI 兼容 API 服务
```

其中 `my_infer.yaml` 由 `examples/inference/qwen3_lora_sft.yaml` 改来，把 `model_name_or_path`、`adapter_name_or_path` 与 `template` 指向你这次的训练结果。

### 第四步——合并、部署、再测一次

要独立部署，需要把 LoRA 适配器合并回基座权重。从 `examples/merge_lora/qwen3_lora_sft.yaml` 改起：

```yaml
model_name_or_path: Qwen/Qwen3-1.7B
adapter_name_or_path: saves/qwen3-1.7b/lora/sft
template: qwen3
trust_remote_code: true
export_dir: saves/qwen3-1.7b-sft-merged
```

```bash
llamafactory-cli export my_merge.yaml
```

绝不要合并到量化过的基座上。然后部署导出目录——vLLM 可以直接吃：

```bash
vllm serve saves/qwen3-1.7b-sft-merged --port 8001 --api-key local-dev \
  --served-model-name qwen3-1.7b-sft \
  --enable-auto-tool-choice --tool-call-parser hermes
```

Ollama 也能部署，但需要先导入——写一个 `FROM /path/to/export` 的 `Modelfile`，再 `ollama create`（仅限受支持的模型架构）。

把调优后的端点注册成一个独立的模型，而不是覆盖基座模型，这样两者才可比：

```bash
penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:8001/v1 --model-id qwen3-1.7b-sft --api-key local-dev
```

然后用同一个 Benchmark 对新的二元组再跑一遍。因为评估记录了产生它的 `(provider, model_id)` 二元组，记分板上现在同时有两者，你只需要看那个差值。如果没有提升，两次运行的 Trace 都在，会告诉你为什么——然后循环重新开始。

## 常见的坑

- **`400 … tools must not be an empty array`**——这是 Harness 发了 `tools: []`；升级到 0.1.1，空列表时该字段会被省略。
- **`400 "auto" tool choice requires --enable-auto-tool-choice…`**——vLLM 服务启动时没带工具调用参数。带上它们重启；在 vLLM 上真正使用工具，无论哪个客户端调用都需要这两个参数。
- **`400 This model's maximum context length is 32768 tokens…`**——Agent 请求的输出 Token 数超过了模型上下文允许的范围。用 `penguin config model add --max-tokens <n>` 设置模型级上限。
- **vLLM 启动时显存不足**——调低 `--gpu-memory-utilization` 或 `--max-model-len`，或者部署量化模型。
- **提示词被截断，或会话中途报上下文长度错误**——在 vLLM 上调大 `--max-model-len`，在 Ollama 上调大 `OLLAMA_CONTEXT_LENGTH` 或 `num_ctx`。
- **模型已经部署好，PenguinHarness 却看不到**——部署或拉取的模型在 `penguin config model add` 之前是不可见的。用 `penguin config model list` 确认（如果它属于你正在开发的应用，记得带 `--root`）。

## 这件事的意义

这里有意思的地方不在于哪一步特别难，而在于四步现在都落在同一套系统里。你部署的模型、跑在它上面的 Agent、判断它好不好的分数、以及修补差距的那次训练，不再是四个各有一套约定、彼此不通的工具。持有这些技能的 Agent 可以自己走完这个闭环：部署、测量、调优、再部署、再测量——而每一轮都写进了事后可审计的 Trace 与记分板。

在本地。用你自己的权重。数据不出本机。

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```
