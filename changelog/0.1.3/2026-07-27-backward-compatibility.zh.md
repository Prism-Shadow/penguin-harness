# 本批次的向后兼容

- **Date:** 2026-07-27
- **Type:** process
- **Scope:** `core`
- **PR:** [#72](https://github.com/Prism-Shadow/penguin-harness/pull/72), [#79](https://github.com/Prism-Shadow/penguin-harness/pull/79)

[English](2026-07-27-backward-compatibility.md)

按仓库规则，本批次的每一项兼容决策都在此记录一次；功能条目引用本文件，而不再复述。

## 旧 Trace 中的 `thinking_level` 在恢复时被忽略（由所有者拍板）

旧 Trace 在其 `session_meta` 中记录了 `thinking_level`；自 0.1.2 起该字段不再写入，而恢复流程此前在它存在时仍会继续尊重它。所有者选择了明确的不兼容而非继续支持：恢复现在完全忽略该字段，一律读取 Agent 的当前配置。**被容忍的旧形态：** 该字段可以出现在旧的 meta JSON 中并被无错跳过（Trace 本身仍完全可读）。**生效范围：** 仅 `resumeSession`；实时行为与逐轮拾取器从未受影响。**用户需要做的：** 无——唯一可见的后果是，被恢复的旧子 Agent 会话会跟随执行恢复的 Agent 所配置的等级，而不是它在派生时继承的那个。**移除：** 无需移除；除了那次容忍性的跳过之外，没有保留任何兼容代码。

## 没有 `{{SHELL}}` 的已有 Agent 通过组装期回退获得 Shell 行

`Shell:` 这一环境行经由新的 `{{SHELL}}` 占位符随默认 `system_prompt` 模板发布——但 `system_config.yaml` 是在 Agent 创建时固化的，且从不自动升级，因此本次发布之前创建的每个 Agent 都没有该占位符，而在 Windows 上，它的模型将永远无从得知 `exec_command` 说的是哪种 shell。这里没有采用磁盘迁移，而是在提示词组装时施加一个窄口径回退：**仅在 win32 上**，当模板中不含 `{{SHELL}}` 且输出中尚无 `Shell:` 行时，在内存中把该行追加到 Environment 区块。**被容忍的旧形态：** 早于 `{{SHELL}}` 的模板（以及自行硬编码了 `Shell:` 行的模板，后者优先）。**生效范围：** Windows 上的提示词组装；POSIX 输出逐字节一致，不重写任何文件。**用户需要做的：** 无；把某个 Agent 的配置恢复为默认值也会带上该占位符，从而使该 Agent 不再需要这个回退。**移除：** 当不再预期野外还存在早于 `{{SHELL}}` 的 Agent 配置时即可删除该回退（由回退处的注释跟踪）。

## 增量式协议字段无需处理

`StopReason` 枚举的第六个取值 `auth`（旧读取方会像 `failed` 一样落入兜底；旧 Trace 中绝不会出现它）、`request_end` 的 `message` 与 `retry_in_ms`、`credentials_updated` 服务端事件，以及模型响应上的 `updatedAt`，全都是增量式的：旧 Trace 只是没有它们，旧读取方会忽略它们，也没有任何东西会对旧数据做出不同解读。在此记录只是为了说明已做过检查；没有需要退役的兼容行为。
