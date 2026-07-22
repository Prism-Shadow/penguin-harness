---
title: "AI 基础设施：过去、现在与未来"
date: 2026-07-22
category: practice
excerpt: PyTorch、vLLM、Ollama、LlamaFactory，都是照着"一个会读文档、会看日志、记得自己启过什么服务的人"来设计的。可现在，越来越多地在驱动它们的是 Agent。这个变化意味着什么，PenguinHarness 今天又为它准备了什么。
---

我们用来构建 AI 的这套基础设施，是照着人来设计的。PyTorch 默认有人在读教程；vLLM 默认工程师清楚自己显卡有多少显存；LlamaFactory 默认研究者会盯着 loss 曲线判断训练正不正常；Ollama 则默认你记得服务是不是已经起来了。

**这些默认无一例外都指向一个人类操作者。而现在，操作者越来越多地是 Agent。**

这篇文章不长，只讲两件事：这个变化带来了什么，以及我们现在为它准备了什么。

## 一、过去：关于"人类操作者"的三个默认

几乎所有 AI 工具链里都埋着三个默认。使用者一旦换成程序，这三个默认全都会悄无声息地失效。

### 1.1 默认使用者把状态记在脑子里

你知道今天早上启过一个 Ollama 服务，也知道昨晚那个训练任务还占着显卡。这些信息不会出现在任何一条命令的输出里，因为人本来就不需要它被写下来。

### 1.2 默认错误信息是排查的起点，而不是行动指令

`CUDA out of memory` 对人来说是条相当好的消息：看一眼，把 batch size 减半，接着干。可它几乎没告诉 Agent 下一步该做什么。而 ML 技术栈里满是这类错误——从八层调用栈深处抛出来的 shape mismatch、NCCL 超时，还有悄悄回落到 CPU，唯一的症状是所有东西慢了四十倍。

### 1.3 默认文档只读一次，而且读的人记得住

教程是按文章写的，讲究从头读到尾，而真正会卡住你的那条约束——模型得放得进显存——躲在中间某一句话里。

Stripe 评测 Agent 能不能基于他们的 API 做出真实集成时，把这笔账算了出来。他们发现的失败模式放到别处同样成立，而且让人不太舒服：Agent 传入了根本不存在的数据，收到 400，然后认为任务已经完成。**错误本身是对的，但它没能把"失败"这件事传达出去。**

## 二、现在：这套技术栈本来就对 Agent 友好

### 2.1 Shell 就是集成层

好消息是，AI 基础设施其实比大多数软件都更适合 Agent，而且属于无心插柳：它本来就是命令行工具、YAML 配置和 Python 文件，文本进、文本出，天然可组合。没必要给 `nvidia-smi` 再包一层什么，**一个拿着 shell 的 Agent 已经能把整个栈跑通了。**

这正是 PenguinHarness 把 shell 当作通用接口的理由：`exec_command` 就是全部的文件与进程接口，没有另外的文件工具。**驱动 vLLM 不算一次"集成"，它就是一条命令。**

### 2.2 真正需要补的，是操作经验

缺的从来不是连通性，而是一个称职工程师有、模型没有的那点**操作经验**。我们把它做成 **Skills**，也就是 Agent 按需读取的指令包。其中三个直接覆盖这套技术栈，归在 AI 应用开发技能组里：

| Skill | 让 Agent 能做什么 |
| --- | --- |
| `ollama` | 拉取并启动本地模型，对外暴露 OpenAI 兼容端点 |
| `vllm` | 在 GPU 上做高吞吐服务，并为 Agent 负载打开工具调用相关参数 |
| `llamafactory` | 用 YAML 配置做 LoRA/QLoRA、SFT 或 DPO 微调 |

比"有这三个技能"更值得说的，是它们里面到底写了什么——每一条都写下了一件人类根本不需要被叮嘱的事：

1. **动手之前，先看清楚现场。** `ollama` 技能会让 Agent 先跑 `ollama --version` 和 `ollama ps`，然后把规矩挑明：如果 11434 端口上已经有服务，就复用它，**绝不去杀已经存在的 Ollama 进程**。人当然知道不该动同事的服务，Agent 却必须被明确告知。
2. **先确认真正卡住你的那条约束。** `vllm` 技能在做任何事之前，先用 `nvidia-smi`（AMD 上是 `rocm-smi`）确认硬件，因为模型规模和上下文长度都被显存卡着。**教程里那句被埋起来的话，在这里被提到了第 0 步。**
3. **要验证，别想当然。** 两个服务类技能都以一次真实检查收尾——`curl http://localhost:8000/v1/models`——过了才算完成。这正好回答了 Stripe 那个失败模式：**"成功"得由一次观测来定义，而不是"没崩就算成了"。**
4. **把活干完，别只起个头。** 模型启动之后，不注册进来 PenguinHarness 是看不见它的，所以技能会用 `penguin config model add --client-type openai --base-url ...` 把这一步闭上，再用 `penguin config model list` 确认一遍。**起一个服务不叫完成任务，拿到一个能用的模型才叫。**
5. **拿不准就问，别猜。** 每个技能开头都是同一句话：如果对方只点了技能名却没说具体要干什么，先问清楚，一条命令都别跑。比如引擎选哪个就听用户的，而不是写死一个默认值——vLLM 用于高吞吐 GPU 服务，Ollama 更省事，也是 macOS 和纯 CPU 机器上的唯一选择。

### 2.3 还有两块运行时能力，因为 AI 的活跟 Web 不是一个形状

**长任务是一等公民。** 训练和服务不可能三十秒跑完。`exec_command` 先在前台等着，一旦命令超出等待窗口，它就转到后台继续跑并返回一个 `process_id`，之后由 `input_command` 去轮询、写 stdin 或者发 Ctrl-C。**Agent 可以先把微调发起来，转头去干别的，过一阵再回来看进度，不需要什么"训练专用工具"。**

**失败以文本返回，而不是抛异常。** 工具永远不会把异常抛进循环里。非零退出、超时、OOM，最后都收敛成模型读得懂、也能据此反应的工具输出；退出码还会被追加在截断窗口**之外**，哪怕长日志被砍掉也还在。这个细节比它听上去更要紧：**告诉你这次真的跑挂了的那一行，通常正好是最后一行。**

## 三、未来：仍然难啃的部分

有三个问题至今没有解决，我们没有，别人也没有。

### 3.1 ML 技术栈的错误信息，还是写给人看的

一段不说明"该改什么"的 traceback，任何 Agent harness 都救不回来。这事得在上游框架里修，而原则其实早就摆在那儿了：好的工具错误应该具体、可执行，而不是甩出一串晦涩的错误码和调用栈。**今天的训练栈里，达到这个标准的部分非常少。**

### 3.2 GPU 是共享资源，却没有一套协议

Agent 能读 `nvidia-smi`，但没有标准办法去预留显存、排队等另一个任务结束，或者提前知道它刚看到的那块空闲显存马上就要被人占走。今天的答案是一条写下来的规矩：别去动不是你启的东西。**那是约定，不是保证。**

### 3.3 可复现性还没有着落

一次微调是耗时、烧钱、还带随机性的动作。Agent 让"发起"这件事变得极其便宜，也就更容易攒出一个谁都复现不出来的模型。快照和 Trace 能帮上忙，但算不上完整答案。

## 四、小结

**AI 基础设施并不需要为 Agent 重新发明一遍，它本来就是文本和命令。** 缺的是围着它的那点操作经验：动手前先看现场，先确认真正的约束，用观测来确认结果，以及把活干完而不是起个头。

这就是我们的 Skills 写下来的东西。底下垫着的，是一个 shell、一套面向长任务的两阶段进程模型，以及以可读文本返回的错误。

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin run -m "用 Ollama 启动 Qwen3.5-0.8B 并注册到 Penguin"
```

---

- **文档**：[Skills](https://penguin.ooo/docs/skills) · [工具与审批](https://penguin.ooo/docs/tools) · [模型与供应商](https://penguin.ooo/docs/models)
- **社区**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**：[vLLM](https://docs.vllm.ai/) · [Ollama](https://ollama.com/) · [LlamaFactory](https://github.com/hiyouga/LlamaFactory) · [Stripe, Can AI agents build real Stripe integrations?](https://stripe.com/blog/can-ai-agents-build-real-stripe-integrations) · [Anthropic, Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
