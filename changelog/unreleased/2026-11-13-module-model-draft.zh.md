# Module 语义的 Lean 草稿

- **Date:** 2026-11-13
- **Type:** process
- **Scope:** `rfcs/formal`
- **PR:** [#1560](https://github.com/Prism-Shadow/penguin-harness/pull/1560)

[English](2026-11-13-module-model-draft.md)

新增定义 Module、Pass 与插件选择的 Lean 草稿，显式列出外部类型检查假设。草稿陈述编辑、延后配方算子、准入、插件重算与停机的定理，证明暂以 `sorry` 保留供评审。

将形式化材料放在 `rfcs/formal/`，新增与 Module 共用声明语义的 Operator 及其组合、局部性与契约保持定理陈述。新增 POPL/PACMPL 版式的 Typst 论文，说明完整机制、模型定义、外部假设与证明边界；RFC 直接规定设计，形式化材料反向引用对应章节。

以统一的抽象语法、明确的设计需求和贯穿示例重组论文，连接 mock 替换、tab 删除、telemetry 与插件卸载。现有候选定理改用同一套语法陈述，定理取舍与证明优先级留待确定。

将声明变换统一命名为 Operator，使用直接应用和 Pass 大步求值，将指令计数移到成本细化中。论文与 RFC 区分操作类型和最终 Module 合法性。

统一论文记号：具名操作使用无衬线正体，完整调用使用括号，部分应用的固定参数使用下标。明确柯里化参数类型与算子组合。
