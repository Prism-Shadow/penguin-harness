# 向后兼容：固化的旧模板、小节占位符、内核版本

- **Date:** 2026-08-11
- **Type:** process
- **Scope:** `core`, `web`
- **PR:** [#257](https://github.com/Prism-Shadow/penguin-harness/pull/257), [#263](https://github.com/Prism-Shadow/penguin-harness/pull/263)

[English](2026-08-11-backward-compatibility.md)

## 提示词注入的小节占位符（[#257](https://github.com/Prism-Shadow/penguin-harness/pull/257)） `system_config.yaml` 是在 Agent 创建时固化的、从不自动升级，因此本次改动之前创建的每个 Agent 都携带旧的模板文本——硬编码的 `# Vault` 与 `# Skills` 小节，内含 `{{VAULT_KEYS}}` / `{{SKILL_METADATA}}` 行内占位符，且没有 schedules 小节。

**被容忍的旧形态。** 对行内 `{{VAULT_KEYS}}` 与 `{{SKILL_METADATA}}` 占位符的模板级替换继续有效，且现在会遵从新的开关：`vault.enabled: false` / `skills.enabled: false` 会把行内列表清空。在这类模板上，开关无法移除围绕该列表固化的小节措辞——那是字面的模板内容；相应标签页会在旧模板上说明这一点。

**影响范围。** 所有在 [#257](https://github.com/Prism-Shadow/penguin-harness/pull/257) 之前创建的 Agent。新建 Agent 得到的是只含占位符的模板，不受影响。

**用户需要动手吗？** 不需要——已有 Agent 继续渲染它们一贯的提示词。若要采纳新的逐功能提示词与完整的开关行为，每个标签页都提供一键迁移，把旧的默认小节替换为占位符；当固化的措辞与旧默认值逐字节一致时该迁移可用（即冻结的 `LEGACY_VAULT_SECTION` / `LEGACY_SKILLS_SECTION` 常量；有测试固定「迁移后的旧默认模板等于当前默认模板」）。手工编辑过的小节绝不会被重写——提示条会把这类模板引向「系统提示词」标签页。Schedules 没有旧形态；它的占位符只是一次普通的一键插入，与 Memory 当初一样。

**何时可以移除。** 行内替换的旧路径与那两个冻结的小节常量都带有退役注释（沿用 `withShellLineFallback` 的约定）：一旦野外不再预期存在 `{{SKILLS}}` 之前时代的 Agent 配置即可移除——现实地说，是在某个发布中推送过一次迁移提示、并且遥测/用户反馈显示已无旧模板残留之后。

## 内核版本（[#263](https://github.com/Prism-Shadow/penguin-harness/pull/263)）

早于本次改动的 `system_config.yaml` 不带 `kernel_version` 戳，因此会被报告为**过期**——这是功能在正常工作，而不是坏了；在用户点击「更新」（或「恢复」）之前什么都不会变。智能合并按哈希识别当前世代与 [#257](https://github.com/Prism-Shadow/penguin-harness/pull/257) 之前的世代；两者都不匹配的取值——更早的世代，或用户的修改——会被保守保留，因此一次更新绝不可能毁掉一处它无法证明是原装的自定义内容。用户无需任何操作。

**何时可以移除。** 那条作为种子的 [#257](https://github.com/Prism-Shadow/penguin-harness/pull/257) 之前的历史条目，与 [#257](https://github.com/Prism-Shadow/penguin-harness/pull/257) 共享同一个退役时点（旧配置消失后一并移除）；而守卫测试与历史表本身是永久性的机制，每一次刻意的默认值变更增加一行。
