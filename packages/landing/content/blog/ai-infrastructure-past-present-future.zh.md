---
title: "AI 基础设施：过去、现在与未来"
date: 2026-07-22
category: perspectives
excerpt: AI 基础设施是为人类操作者打造的，如今驱动它的越来越多是 Agent。这套技术栈本身就适合 Agent，Agent 缺的是工程师的操作经验，PenguinHarness 把这些经验做成了 Skill。
---

> 本文基于 PenguinHarness 0.1.1 撰写，之后的版本在部分细节上可能有所不同。

我们用来构建 AI 的这套基础设施，是照着人来设计的。PyTorch 默认有人在读教程；vLLM 默认工程师清楚 GPU 有多少显存；LlamaFactory 默认研究者会看训练曲线，判断训练是否正常；Ollama 则默认你记得服务是不是已经在运行。

这些默认针对的都是人类操作者，而现在，操作者越来越多地换成了 Agent，也就是靠调用工具干活的模型。本文要回答的问题是：驱动这套技术栈的一方换成程序之后，会发生什么变化。我们的回答是，技术栈本身几乎不用改，它本来就是文本和命令，Agent 通过 shell 就能跑起来。

Agent 缺的是称职工程师身上的操作经验。这些经验可以写下来，PenguinHarness 现在就把它们做成了 Skill，运行时也支持长任务，失败会以可读文本返回。另外还有三个问题，目前谁都没有解决。

## 过去：技术栈默认操作者是人

几乎所有 AI 工具都默认了关于操作者的三件事。操作者一旦换成程序，这三条默认会悄无声息地全部失效。

### 操作者把状态记在脑子里

第一个默认是，用户记得有哪些东西在运行。你知道今天早上启动过一个 Ollama 服务，也知道昨晚的训练任务还占着 GPU。这两件事不会出现在任何命令的输出里，因为人从来不需要把它们写下来。只看得到命令输出的 Agent，两件事都无从知道。

### 报错是排查的起点

第二个默认是，报错是人开始排查的起点。`CUDA out of memory` 对人来说是条挺好的报错：看一眼，把 batch size 减半，接着干。可它几乎没告诉 Agent 下一步该做什么。ML 技术栈里满是这类报错：从八层调用栈深处抛出来的 shape 不匹配，NCCL 超时，还有悄悄回退到 CPU 运行，唯一的症状是一切都慢了四十倍。

Stripe 评测 Agent 能不能基于自家 API 做出真实集成时，算过这笔账。他们发现的失败模式放到别处同样成立：Agent「会传入根本不存在的 Stripe 数据，收到 400，然后认为任务已经完成」。报错本身没有错，却没能把「失败」传达出去。

### 文档只读一遍

第三个默认是，文档只读一遍，而且读的人记得住。教程写成文章，要从头读到尾。最重要的约束，比如模型必须放得进显存，只是埋在中间某处的一句话。

## 现在：技术栈天然适合 Agent

这套技术栈不需要为 Agent 新增接口。它需要的是操作经验，以及一个贴合 AI 工作的运行时，因为 AI 的活和 Web 的活形态不同。

### Shell 就是集成层

AI 基础设施比大多数软件更适合 Agent，而且纯属无心插柳。它本来就是命令行工具、YAML 配置和 Python 文件：文本进，文本出，可以自由组合。`nvidia-smi` 这类工具用不着再包一层，一个拿着 shell 的 Agent 已经能驱动整个技术栈。

所以 PenguinHarness 把 shell 当作通用接口：在 0.1.1 版本里，`exec_command` 就是全部的文件系统与进程接口，还没有单独的文件工具。驱动 vLLM 算不上一次集成，它就是一条命令。

### 缺的是操作经验

缺的不是连通性，而是称职工程师有、模型没有的操作经验。PenguinHarness 把这些经验做成 **Skill**，也就是 Agent 按需读取的指令包。其中三个归在「AI 应用开发」分组，直接覆盖这套技术栈：

| Skill | Agent 能用它做什么 |
| --- | --- |
| `ollama` | 拉取并启动本地模型，对外暴露 OpenAI 兼容端点 |
| `vllm` | 在 GPU 上做高吞吐服务，并为 Agent 负载打开工具调用参数 |
| `llamafactory` | 用 YAML 配置做 LoRA/QLoRA、SFT 或 DPO 微调 |

比起「有这几个 Skill」，更值得说的是它们里面写了什么。它们写下的规则，人类操作者从来不需要别人叮嘱：

1. **动手之前，先看清现场。** `ollama` Skill 让 Agent 先运行 `ollama --version` 和 `ollama ps`，然后把规矩挑明：如果 11434 端口上已经有服务，就复用这个实例，绝不杀掉已经在运行的 Ollama 进程。人知道不该动同事的服务，Agent 却得有人明确告诉它。
2. **先确认真正的约束。** `vllm` Skill 在启动服务之前，先用 `nvidia-smi`（AMD 上是 `rocm-smi`）确认硬件，因为模型大小和上下文长度都受显存限制。教程里埋在中间的那句话，在这里成了第 0 步。
3. **要验证，别想当然。** 两个服务类 Skill 都以一次真实检查收尾，比如 vLLM 的 `curl http://localhost:8000/v1/models`，检查通过才算完成任务。这正是对 Stripe 那个失败模式的直接回应：「成功」由一次观测来定义，而不是「没崩溃就算成功」。
4. **把活干完。** 模型启动后不注册，PenguinHarness 就看不见它。所以这些 Skill 会用 `penguin config model add --client-type openai --base-url ...` 把这一步闭环，再用 `penguin config model list` 确认结果。启动一个服务不算完成任务，拿到一个能用的模型才算。
5. **拿不准就问，别猜。** 三个 Skill 的开头都一样：如果请求只点了 Skill 的名字、没给具体目标，Agent 会先问清楚，一条命令都不跑。选哪个引擎也听用户的，而不是写死一个默认值：vLLM 用于高吞吐的 GPU 服务，Ollama 是省事的默认选项，也是两者中唯一能在 macOS 或纯 CPU 机器上运行的。

### 长任务是一等公民

训练和服务不可能三十秒跑完，所以运行时把长任务当作常态。`exec_command` 先在前台等待；命令一旦超出等待窗口，就转到后台继续运行，工具返回一个 `process_id`。之后由 `input_command` 轮询这个进程、向它的 stdin 写入内容，或者发送 Ctrl-C。Agent 可以先把微调跑起来，转头去做别的事，过一阵再回来看进度，不需要专门的训练工具。

### 失败以文本返回

工具永远不会把异常抛进 Agent 循环。非零退出、超时、内存耗尽（OOM），最后都会变成工具输出，交给模型读取和应对。退出码追加在截断窗口之外，哪怕长日志截断了，退出码也还在。这个细节比听上去更要紧：表明运行失败的那一行，通常就是最后一行。

## 未来：三个尚未解决的问题

有三个问题至今没有解决，我们没有，别人也没有。

### ML 技术栈的报错仍是写给人看的

Agent Harness 是运行 Agent 循环和工具的软件。一条不说明该改什么的 traceback，任何 Agent Harness 都救不回来。这件事得在上游的框架里解决。指导原则其实早就有了：[Anthropic 关于为 Agent 编写工具的建议](https://www.anthropic.com/engineering/writing-tools-for-agents)指出，好的工具报错应当具体、可执行，而不是一串晦涩的错误码和 traceback。今天的训练技术栈里，达到这个标准的部分非常少。

### GPU 是共享资源，却没有协议

Agent 能读 `nvidia-smi`，但预留显存、排队等其他任务结束、提前知道刚看到的显存马上就有别的任务要用，这些都没有标准做法。今天的答案是一条写下来的规矩：不是你启动的进程，就别去杀。这是约定，不是保证。

### 可复现性还没有着落

一次微调耗时长、成本高，还带随机性。Agent 让发起这类运行变得很便宜，也就更容易攒出一个谁都复现不了的模型。快照和 Trace 能帮上忙，但算不上完整的答案。

## 结语

AI 基础设施不需要为 Agent 重新发明一遍，因为它本来就是文本和命令。缺的是围绕它的操作经验：动手之前先看现场，先确认真正的约束，用观测来验证，把活干完而不是只起个头。

PenguinHarness 把这些经验写进了 Skill，底下垫着的是 shell、面向长任务的两阶段进程模型，以及以可读文本返回的错误。下面的命令先安装 PenguinHarness，再让 Agent 启动一个本地模型服务并完成注册：

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin run -m "用 Ollama 启动 Qwen3.5-0.8B 并注册到 Penguin"
```

---

- **文档**：[技能与插件](https://penguin.ooo/docs/skills) · [工具与审批](https://penguin.ooo/docs/tools) · [模型与供应商](https://penguin.ooo/docs/models)
- **社区**：[GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**参考来源**：[vLLM](https://docs.vllm.ai/) · [Ollama](https://ollama.com/) · [LlamaFactory](https://github.com/hiyouga/LlamaFactory) · [Stripe, Can AI agents build real Stripe integrations?](https://stripe.com/blog/can-ai-agents-build-real-stripe-integrations) · [Anthropic, Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
