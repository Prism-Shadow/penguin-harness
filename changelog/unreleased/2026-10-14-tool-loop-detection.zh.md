# 卡在同一批工具调用上的模型会终止该轮

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1259](https://github.com/Prism-Shadow/penguin-harness/pull/1259)

[English](2026-10-14-tool-loop-detection.md)

不断用相同参数发起相同工具调用的模型永远到不了最终回复，而 ReAct 循环只受 `maxTurns` 约束——它默认无限。走到那一步的 run 并不会失败：它一直在同一个调用上工作下去，流里也没有任何东西说明原因。

## 做了什么

引擎保留最近若干个**发起了工具调用**的轮次的**签名**（该轮的 `name:argsDigest` 对，排序后拼接，因此同一批调用换顺序仍是同一签名）。连续四个相同轮次——三个的连续段加上它前面那一个——就以 **`tool_loop` cutoff** 终止该轮，并在流里说明是什么停下了它：

```
[tool loop detected: the same tool calls (exec_command, exec_command) repeated across consecutive turns — stopping]
```

- **是四个，不是一个。** 用相同参数的正当重试（一次瞬时失败、一次重读）不是循环；这个窗口正是用来区分两者的。
- **只在轮次边界判定。** 签名取自某一轮实际发起的调用，因此只要模型在换参数——或换工具——它工作多久都不受影响。
- **新上下文是新的开始**：上下文打开时清空窗口，与它旁边那个轮次计数一样。
- **`maxTurns` 未改动**，仍然生效；这里要接住的正是它被设为无限的情形——也就是默认值。

## 兼容性

`RunCutoff.kind` 新增 `"tool_loop"`。对该 kind 做穷举 switch 的调用方需要处理它；其余 kind 的行为与之前完全一致。
