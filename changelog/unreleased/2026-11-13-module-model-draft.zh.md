# Module 语义与 Lean 证明

- **Date:** 2026-11-13
- **Type:** process
- **Scope:** `rfcs/formal`
- **PR:** [#1560](https://github.com/Prism-Shadow/penguin-harness/pull/1560)

[English](2026-11-13-module-model-draft.md)

新增涵盖 Module 声明、Operator、Pass、Plugin 重放与本地 HMR 的 Lean 模型，补全证明并显式列出外部类型检查假设。基础性质放在 `Basics.lean`，主要结果分别放在 `Proofs/Normalization.lean`、`Proofs/Plugin.lean` 与 `Proofs/HMR.lean`。

新增 POPL/PACMPL 版式的 Typst 论文。第三章介绍语义和基础性质；第四章围绕延后 Operator 规范化、Plugin 重配置与 Cordis 2026 的比较、Hot Module Reload 展开；基础定律与证明论证放在附录。

形式化编译步骤与失败尝试历史，补充仅凭输出无法反演删除、仅凭 DI 图无法确定编译影响范围的反例。新增 HMR 协议，覆盖计划合法性、代际代码与 Task、资源、恢复代码的传递保留、恢复失败后的降级状态及基于注册 token 的清理。论文标明 TypeScript 实现尚待满足的细化义务，不包含包传输协议。

将声明变换统一命名为 Operator，统一无衬线正体操作名、柯里化类型、完整调用与部分应用记号。形式化材料引用对应 RFC，并区分操作类型与最终 Module 合法性。
