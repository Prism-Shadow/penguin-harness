# 截断的工具输出在头部之外保留尾窗

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `core`, `docs`

[English](2026-08-23-tool-output-tail-window.md)

工具输出超过 `maxOutputLength` 时，此前只保留前 `maxOutputLength` 个字符、丢弃其后一切。而超预算最常见的命令类输出，最有信息量的部分恰恰在末尾：测试判定、报错、退出前的最后几行。模型看到的是一整段顺利运行的开头噪音，想知道这次运行怎么收场，只能再去读 recovery 文件。

现在预算对半开。头窗照常实时流式转发；超出头窗的文本暂扣进定容滚动尾缓冲。收尾时，未超预算的输出原样补出——结果完整，只是后半段在收尾时到达；超预算的输出则收敛为头窗、带计数的标记与最后一个尾窗：

```
<预算的前一半>
[output truncated: kept first 8000 and last 8000 of 913482 chars]
<预算的后一半>
[output archived: <session scratchpad>/truncated-tool-output/exec_command-<hash>.log]
```

标记里的总量是新增的信号：模型据 `C` 即可判断值不值得再花一次调用去读 recovery 文件。对半分镜像 recovery 文件自身的头尾窗规则，单一常量、后续可调。

## 不变的部分

- 流式不变量保持：流式增量拼接仍严格等于完整 `tool_call_output`，截断亦不例外。标记、尾窗、终止注记（如退出码）与归档注记都在收尾时以补偿增量补出。
- Recovery 归档完全不动：同样的触发条件、同样的单调用 8 MiB − 1 上限、同样的文件格式、同样随 Session scratchpad 的生命周期。
- `maxOutputLength <= 0` 仍表示完全关闭预算；未配置 Session scratchpad 的独立 SDK 嵌入仍是纯截断行为——只是同样获得尾窗。

## 细节

- 两处切口对 UTF-16 代理对安全：头窗不会终止在可配对的高位代理上（该字符转入暂扣，冲刷时与低位重聚），尾窗也不会以被切断的低位代理开头。可见输出不再在切口处出现替换字符。
- 结束于头窗之后、预算之内的输出，从实时到达改为收尾时到达。只有这一区间的送达时机变化，内容完整且不带标记。
- 截断标记从追加注记移入正文、位于两窗之间，措辞由 `exceeded N chars` 改为 `kept first H and last T of C chars`。前端把工具输出当纯文本渲染，无需任何渲染层改动；旧 Trace 保留旧标记、照常渲染。
- 只返回一条完整消息的兼容工具，对该消息套用同样的双窗。

设计：头尾双窗契约与 recovery 归档已入设计规格（[penguin-harness-design #54](https://github.com/Prism-Shadow/penguin-harness-design/pull/54)）。
