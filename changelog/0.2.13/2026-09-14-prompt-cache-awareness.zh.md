# core 测试固定了面向 Prompt 缓存的请求组装

- **Date:** 2026-09-14
- **Type:** process
- **Scope:** `core`
- **PR:** [#722](https://github.com/Prism-Shadow/penguin-harness/pull/722)

[English](2026-09-14-prompt-cache-awareness.md)

只有当下一次请求从头逐字节重复上一次——先 tools，再 system prompt，最后 messages——供应商才会命中
缓存前缀，因此引擎组装的每一轮都必须让请求保持为上一次的延长。
`packages/core/test/prompt-cache-invariants.test.ts` 现在固定了这一点：由真实的 `ContextEngine`
驱动真实的 `GenerativeModel`（其供应商流被脚本替换），对每一对相邻请求按客户端真正会发出的 wire
形态做诊断，诊断口径对齐供应商上报的缓存未命中原因（`model_changed` / `system_changed` /
`tools_changed` / `parameters_changed` / `messages_changed`，取最早的分歧点，并给出分歧之后的
输入量估算）。

## 细节

- 被固定的行为：一个 Session 的每次请求都延长上一次；任务执行中投递的 steering 与工具结果同乘一条
  user 轮次；调整 thinking 级别只产生一次 `parameters_changed` 并就此保持——压缩请求与压缩开出的新
  上下文都带着调整后的级别；压缩请求延长它紧跟的那一轮；恢复会话的首个请求以活动客户端已提交的
  历史开头，thinking 签名与工具配对都在。
- 有一条读数值得单独写成不变量：流式输出中途断线后的重连，会把这一轮连同一条带上已产出内容的 `[turn_retried]` 说明一起重发，因此被重试那一轮的输入是「变长」而不是「原样重复」。它之前的所有消息逐字节不变（工具、系统提示词与历史仍然命中）；测试固定的是分歧点绝不会提前，且原输入仍位于重试输入的开头。
- `packages/core/test/helpers/prompt-cache/` 按职责分文件收纳共用设施：`recording.ts`（脚本化的
  供应商流与逐请求的 wire 录制）、`diagnostics.ts`（缓存未命中诊断）、`simulator.ts`（下面那一半
  供应商规则）与 `fixtures.ts`（两个 Session 测试共用的 Agent、假协作者与命中断言），并由
  `index.ts` 统一再导出。录制与诊断只度量 harness 这一半：缓存有效期、断点回溯范围与最小可缓存
  长度属于供应商——由模拟器在离线状态下建模，但只有真实 endpoint 才能证明某个实际部署确实如此。
- `packages/core/test/helpers/prompt-cache/simulator.ts` 以规则引擎的形式补上供应商这一半，输入仍是
  同一批录制请求：一个 Anthropic 形态的 Prompt 缓存，把每次请求读成 block 列表（Model id 一个 block、
  每个工具一个、承载 fast mode 参数的虚拟 block 一个、system prompt 一个、承载其余影响 Prompt 的参数
  的虚拟 block 一个，随后是每条消息的每个内容 block），再归并成 position（连续的 `tool_use` 或
  `tool_result` 合并为一个），**只在断点处写入**，读取时每个断点都从自己所在的 position 往前回溯，最多
  检查二十个 position（断点本身算第一个），拒绝缓存不足 1024 Token 的前缀，并按可注入的时钟在最后一次
  使用后五分钟过期。这个 block 顺序正是文档所述失效层级的还原，也包括缓存按 Model 隔离这一条：切换
  Model 会丢掉全部前缀，且没有任何断点能排在它前面；切换 fast mode 保住工具、丢掉 system prompt；调整
  thinking 级别两者都保住——这一条只在把 thinking 配置渲染在它们之后的 Model 上成立，文档本身就标注为
  因 Model 而异。默认建模的就是 AgentHub 的 Claude 客户端当前发出的形态：最后一个
  block 上只有一个自动断点，因此缓存中的条目全都以「整个请求」结尾，断点之后的内容永远不可单独寻址。
  `breakpoints: "tools-system-automatic"` 选项建模 API 允许的另一种布局——在最后一个工具 block 与
  system block 上各加一个显式断点，与自动断点并存。它的输出就是供应商上报的那几个数：
  `cache_read_input_tokens`、`cache_creation_input_tokens`、`input_tokens` 与由此得到的命中率。
  `packages/core/test/prompt-cache-simulator.test.ts` 用手工构造的请求固定这些规则本身。
- `packages/core/test/prompt-cache-lifecycle.test.ts` 让真实 `Session` 跑完整个会话生命周期，所有
  请求（含子 Session 与压缩后开出的新上下文）都送进同一个模拟供应商，并用这些数值断言：每次请求都能
  读回本上下文上一次请求的完整前缀——普通对话、中断、`run_in_background` 命令的完成通知、用户把执行
  中的调用转入后台、一轮三个并行工具调用、子 Agent、定时任务触发、经 Trace 恢复、调整 thinking 级别
  与上下文压缩。
  每一种按设计无法命中的情形都写明原因并给出损失上界：中断回退到它前一次请求所封闭的那个断点；调整
  thinking 级别、压缩重开上下文、子 Agent 的首个请求三者都读到 0——哪怕工具与 system prompt 逐字节相同
  也如此，因为断点只在请求末尾，从来没有条目以 system block 结尾。
- 多加两个断点能挽回多少，是被测出来而不是被论证出来的；而且测在手工构造的请求上，既不占用一次场景
  驱动，也不会随 AgentHub 的变化而漂移：在 `breakpoints: "tools-system-automatic"` 下，改 system
  prompt 仍能读回 tools，切换 fast mode 仍能读回 tools，调整 thinking 级别仍能读回 tools 加 system
  prompt，消息数远超回溯窗口的对话也仍能从紧邻的那个断点读回固定前缀——而 harness 今天只发一个自动
  断点，以上每一种情形都读到 0。两种布局下 system 断点之后的参数 block 都读不回来，因此调整 thinking
  级别依旧要付出全部消息的代价。
