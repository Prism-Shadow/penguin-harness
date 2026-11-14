# PRFC-0025 Module Pass：boot 前的不可变 operator

[English](PRFC-0025-module-pass.md)

- Feature Name: `module_compile`
- Start Date: 2026-10-25
- Rev: v2.0.0

## Summary

Pass 在装配后的模块树上组合不可变 operator。结构编辑按声明顺序各执行一次；decoration 规则在最终结构上选目标，最终验证通过后才 boot。Manifest 数据负责注册，插件工厂提供 pass 代码。Blueprint/BootPlan/Runtime 的划分见 [Module](PRFC-0001-module.zh.md)，换代语义见 [Plugin](PRFC-0003-plugin.zh.md)。

## Motivation

Instrument 应覆盖后续 pass 生成的节点，无需反复改写直到收敛。同一套接口还要支持 mock 与删除某个槽贡献。作者应能写简短的 `pipe`，无需实现树遍历或手写 SQL AST。先开放普通 TypeScript operator 与 predicate，再依据使用经验收紧核心。

## Guide-level explanation

```ts
const testMode: ModulePass = {
  id: "test-mode",
  rewrite: pipe(
    replace(byName("Sessions"), fakeSessions),
    at("Chat.sessionTabs", filter(not(byId("legacy")))),
    decorate(provides(sessionsApi), instrumentSessions),
  ),
};
```

`at` 将集合 operator 提升为对某个槽全部贡献的操作；删除贡献不移除仍有其他用途的组件。MVP 保持贡献者之间的顺序，允许同一贡献者内部重排；跨贡献者重排会被拒绝，新增条目也必须指向已有贡献者。`replace` 保持模块身份，新依赖与提供物是否兼容由最终验证决定。`when`、`and`、`or`、`not` 组合条件。普通条件读取该步骤的输入，不在后续步骤完成后回头重跑。

`decorate` 登记规则。编译器在结构编辑全部结束后选择具体 provision alias，排除 exports 转发的 alias，每条匹配规则对同一 provider 值在 boot 时包装一次。Wrapper 创建的值不成为新的编译目标。Telemetry 演示有类型的成员包装，覆盖在其 pass 之后加入的 provider，插件自己无需递归遍历。

模块通过数据注册 pass：

```json
{ "contributes": { "CompileModule.passes": [{ "id": "telemetry" }] } }
```

插件在 `passes.telemetry` 导出工厂，每次 compile 尝试重新解析。本次重试的工厂和注册都来自实际保留的插件集合。

## Reference-level explanation

### 执行

1. 对装配后的原始树建立快照，包括嵌套 manifest 数据；保留不透明代码引用，编译编辑不执行模块工厂。快照保护旧输入与原始声明。
2. 一次性收集注册，重复 id 报错；按 `after` 拓扑排序，以 id 字典序破平局。缺失依赖表示「若存在则排在其后」，成环具名报错。Pass 新建的注册不在本次 compile 调度。
3. 每个 pass 执行一次。内置 operator 复制改变的路径，并按原始子树快照遍历。`add`、`remove`、`replace` 编辑结构，`at` 编辑槽集合。Rewrite 期间失败时，同时丢弃编辑和延后规则。任意 TypeScript `rewrite` 作为开放接口保留，不承诺一般停机。
4. 在最终树上解析 decoration。按完整接口键匹配，用有类型的 handle 编写 wrapper，不依赖 `Function.name`。Exports 转发已包装的子节点值，不重复包装。规则按 pass/operator 顺序组合，后者在外层。
5. 最终统一验证并保留诊断来源，中间态允许语义失配。图验证与 TypeScript 赋值检查分别进行；类型兼容沿用 PRFC-0001 的声明渲染机制。
6. Boot 已验证候选。重装配和恢复都从原始声明开始，不复用已装饰的输出作为源树。

MVP 保留原始 `rewrite` 开放接口。内置 operator 的来源包括 pass id、operator 位置与名称、受影响模块/槽、删除和供应插件。自定义回调保守归因到 pass。源码位置、条件判断的控制来源可以后续细化，不得宣称唯一因果归责。

### 诊断与 profile

诊断来源独立于 debug 计时收集。最终错误报告受影响关系与相关 operator，包括删除者。延迟 selector 或 wrapper 失败时报告对应 operator，候选被拒绝，best-effort 恢复排除供应插件后重建。Pass 修改别人的节点时优先归因给供应 pass，再回退到模块归属；best-effort 排除供应插件后从原始声明重建。

`PENGUIN_MODULE_COMPILE_DEBUG=1` 收集 pass 耗时与最终树。优化依据 profile，不追求墙钟时间定理。接口数不足以约束编译成本，分别记录 requirement/候选对数、中间结果规模、声明生成量与 tsc 工作量，不因目录里存在接口就枚举全部接口对。

### 模型证明范围

初期使用 Lean 4，仅证明模型。固定环境中的 TypeScript 类型与兼容关系作为无解释参数。对任意有限输入证明不依赖 fuel 的停机，使用有限输入快照或良基下降量；新增节点无需减少树大小，但不得让遍历自动在自己的输出上重新调度。任意 TS 回调、tsc 执行、import、migration 与运行时副作用不在该定理内。

其他目标包括表示约束保持、编辑局部性、针对固定身份集合的结构删除幂等与交换性、纯逐项 filter 融合、确定性组合、来源有效性和最终约束覆盖。等价关系需说明是否忽略执行历史，结构等价的改写可能产生不同日志。插件安装/卸载、准入、保留和恢复的证明目标见 PRFC-0003。这些是待完成证明，不是实现已验证的声明。

将来若需验证实现，复用模型实现可执行的已验证核心，或验证指定变换的结果检查器。输出类型合法不证明作者要求的删除或替换已经执行。实际性能仍通过 profile 解决。

## Drawbacks

冻结快照和来源记录有成本，延后规则需要最终选择阶段。任意回调保留 MVP 灵活性，也缩小可证明范围。现有类适配器仍在装配时构造实例，boot 仍重复解析布线；这些限制在 PRFC-0001 明示。

## Rationale and alternatives

RxJS 风格的函数组合保持简短。复杂查询语言 AST 与优化器暂不引入。任意固定点改写调度让 instrument 覆盖和停机依赖收敛；在最终目标上应用 decoration 避免这一要求。仅删除插件拥有的输出不能撤销跨插件改写，所以卸载必须重算。

## Prior art

Pipeable operator 借鉴 RxJS 的组合风格；持久化数据结构提供可复用快照和路径复制的思路；编译器 source map 启发诊断映射，并补充 operator 与删除来源。

## Unresolved questions

- 依据经验将普通 TS 回调收紧为可证明的 operator 核心。
- 超出 MVP 操作级记录的精确字段来源与否定谓词来源。
- 可复用类配方、冻结布线证据与 tsc 编译上下文复用。
- 改变存量数据行为之前确定代码资源保留及移除状态的策略。

## Future possibilities

在代表性接口目录上 profile 后，再决定增量执行与查询优化。参考模型测试可以对照 TS 与 Lean 的执行，但不宣称实现证明。未来的生产检查器可验证变换证据，必须检查指定操作，不能只检查最终类型。

## Changes

### v2.0.0

- Updated：未合并的 module-pass 草稿从 PRFC-0021 调整为 PRFC-0025；PRFC-0021 已用于 Distros。
- Updated：不可变 pipeable 编辑、最终目标 decoration、插件 pass 工厂、诊断来源、换代重放与仅证明模型的范围。
- Removed：以注册顺序破平局，以及 instrument 依赖反复改写的语义。

### v1.0.0

- Added：manifest 注册、模块树 compile 管线、boot 接缝与可选 debug 输出。
