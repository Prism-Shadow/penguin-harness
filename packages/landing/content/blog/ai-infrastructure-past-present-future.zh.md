---
title: "AI 基础设施：过去、现在与未来"
date: 2026-07-22
category: practice
excerpt: PyTorch、vLLM、Ollama、LlamaFactory 都是为"一个会读文档、会看日志、记得自己启过什么服务的人"设计的。而现在，越来越多地在驱动它们的是 Agent。本文讲清楚这带来了什么变化，以及 PenguinHarness 今天为此提供了什么。
---

我们用来构建 AI 的基础设施，是为人设计的。PyTorch 假设有人在读教程；vLLM 假设工程师知道自己显卡有多少显存；LlamaFactory 假设研究者会看着 loss 曲线判断训练是否正常；Ollama 假设你记得服务是不是已经起来了。

**这些假设无一例外都是关于人类操作者的。而现在，操作者越来越多地是 Agent。**

这是一篇短文，讲这件事改变了什么，以及我们已经为此提供了什么。

## 一、过去：关于"人类操作者"的三个假设

几乎所有 AI 工具链都贯穿着三个假设，而当使用者变成程序时，三个全都悄悄失效。

### 1.1 假设使用者把状态记在脑子里

你知道今早启过一个 Ollama 服务，知道昨晚那个训练任务还占着显卡。这些信息不在任何一条命令的输出里，因为人根本不需要它被写下来。

### 1.2 假设错误信息是排查的起点，而不是行动指令

`CUDA out of memory` 对人是一条相当好的消息——看一眼，把 batch size 减半，继续。但它几乎没告诉 Agent 下一步该做什么。而 ML 技术栈里全是这种错误：从八层调用栈深处抛出的 shape mismatch、NCCL 超时、悄无声息地回落到 CPU——后者的唯一表现是一切慢了四十倍。

### 1.3 假设文档只读一次，且读的人记得住

教程是按散文写的，从头读到尾，而真正卡住你的那条约束——模型必须放得进显存——是中间某一句话。

Stripe 在评测 Agent 能否基于其 API 构建真实集成时，量化了这件事的代价。他们发现的失败模式推广性好得让人不安：Agent 会传入并不存在的数据、看到 400、然后认为任务已经完成。**错误是正确的，但它没能把"失败"传达出去。**

## 二、现在：这套技术栈本来就适合 Agent

### 2.1 Shell 就是集成层

好消息是，AI 基础设施其实比大多数软件都更适合 Agent，而且是无心插柳：它本来就是命令行工具、YAML 配置和 Python 文件——文本进、文本出、可组合。没必要给 `nvidia-smi` 包一层什么东西，**一个拿着 shell 的 Agent 已经能驱动整个栈了。**

这正是 PenguinHarness 把 shell 作为通用接口的原因——`exec_command` 就是全部的文件与进程接口，没有独立的文件工具。**驱动 vLLM 不是一次"集成"，就是一条命令。**

### 2.2 真正需要构建的：操作性知识

缺的不是连通性，而是一个称职工程师具备、模型不具备的**操作性知识**。我们把它做成 **Skills**——Agent 按需读取的指令包。其中三个直接覆盖这套技术栈，属于 AI 应用开发技能组：

| Skill | 让 Agent 能做什么 |
| --- | --- |
| `ollama` | 拉取并服务本地模型，暴露 OpenAI 兼容端点 |
| `vllm` | 在 GPU 上做高吞吐服务，并为 Agent 负载开启工具调用相关参数 |
| `llamafactory` | 通过 YAML 配置做 LoRA/QLoRA、SFT 或 DPO 微调 |

比"它们存在"更有意思的是**它们里面写了什么**，因为每一条都编码了一个人类根本不需要被告知的规则：

1. **动手之前先看世界。** `ollama` 技能让 Agent 先跑 `ollama --version` 和 `ollama ps`，然后把规则挑明：如果 11434 端口已在服务，就复用该实例——**绝不杀掉已存在的 Ollama 进程**。人知道不该杀同事的服务，Agent 必须被告知。
2. **先验证真正卡住你的那条约束。** `vllm` 技能在做任何事之前先用 `nvidia-smi`（AMD 上是 `rocm-smi`）确认硬件，因为模型规模与上下文长度受显存约束。**教程里那句被埋起来的话，变成了第 0 步。**
3. **要验证，不要假设。** 两个服务类技能都以一次真实检查收尾——`curl http://localhost:8000/v1/models`——通过了才算完成。这正是对 Stripe 那个失败模式的直接回答：**成功的定义是一次观测，而不是"没有崩"。**
4. **把活干完。** 一个已启动的模型在注册之前对 PenguinHarness 是不可见的，所以技能会用 `penguin config model add --client-type openai --base-url ...` 闭环，再用 `penguin config model list` 确认。**启动服务不是任务，拿到一个可用的模型才是。**
5. **不确定就问，别猜。** 每个技能开头都是同一句：如果请求只点了技能名却没有具体目标，先问，一条命令都不要跑。比如引擎选择就遵循用户偏好而非硬编码默认值——vLLM 用于高吞吐 GPU 服务，Ollama 是简单默认项，也是 macOS 或纯 CPU 机器上的唯一选择。

### 2.3 两块运行时能力：因为 AI 工作的形状不同

**长任务是一等公民。** 训练和服务不会在三十秒内结束。`exec_command` 先在前台等待，一旦命令超出窗口就转入后台运行并返回 `process_id`，随后由 `input_command` 轮询、写 stdin 或发送 Ctrl-C。**Agent 可以启动一次微调、去做别的事、再回来查看进度——不需要什么"训练专用工具"。**

**失败以文本返回，而不是异常。** 工具永不向循环抛异常。非零退出、超时、OOM——全部收敛成模型可读可反应的工具输出，并且退出码被追加在截断窗口**之外**，即使长日志被砍掉也依然幸存。这个细节比听起来重要：**告诉你这次跑真的失败了的那一行，通常正是最后一行。**

## 三、未来：仍然困难的部分

有三个问题没有被解决——我们没有，别人也没有。

### 3.1 ML 技术栈的错误信息仍然是写给人的

一个不说明"该改什么"的 traceback，任何 Agent harness 都救不了。修复必须发生在上游框架里，而指导原则其实早就有了：好的工具错误应当具体、可操作，而不是晦涩的错误码和调用栈。**今天训练栈里符合这个标准的部分非常少。**

### 3.2 GPU 是共享资源，却没有协议

Agent 能读 `nvidia-smi`，但没有标准方式去预留显存、排队等待另一个任务，或者得知它刚看到的那块空闲显存马上就要被占走。今天的答案是一条写下来的规则——不要杀你没启动的东西——那是约定，不是保证。

### 3.3 可复现性尚未解决

一次微调是长时间、高成本、带随机性的动作。Agent 让"发起"这件事变得极其廉价，也因此更容易得到一个谁也复现不出来的模型。快照和 Trace 有帮助，但不是完整答案。

## 四、一句话版本

**AI 基础设施并不需要为 Agent 重新发明——它本来就是文本和命令。** 缺的是围绕它的操作性知识：动手前先检查、先验证真正的约束、用观测确认结果、以及把活干完而不是起个头。

这就是我们的 Skills 所编码的东西，其下是一个 shell、一套面向长任务的两阶段进程模型，以及以可读文本返回的错误。

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin run -m "用 Ollama 启动 Qwen3.5-0.8B 并注册到 Penguin"
```

---

- **文档**：[Skills](https://penguin.ooo/docs/skills) · [工具与审批](https://penguin.ooo/docs/tools) · [模型与供应商](https://penguin.ooo/docs/models)
- **社区**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**：[vLLM](https://docs.vllm.ai/) · [Ollama](https://ollama.com/) · [LlamaFactory](https://github.com/hiyouga/LlamaFactory) · [Stripe, Can AI agents build real Stripe integrations?](https://stripe.com/blog/can-ai-agents-build-real-stripe-integrations) · [Anthropic, Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
