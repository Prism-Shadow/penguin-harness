# PRFC-0025 Module Pass：boot 前的不可变 operator

[English](PRFC-0025-module-pass.md)

- Feature Name: `module_compile`
- Start Date: 2026-10-25
- Rev: v2.1.0

## Summary

Pass 是 Module 编辑与延后 decoration 的有限组合。编辑产生同一 Module 类型的新值，decoration 规则在最终结构结果上选择目标，最终验证通过后才 boot。[Module](PRFC-0001-module.zh.md) 定义声明与合法性，[Plugin](PRFC-0003-plugin.zh.md) 定义选择与重建，三者共同构成语义核心。TypeScript 树适配器提供 pipeable 作者接口、manifest 注册与插件工厂；[Lean 草稿](../formal/module-model/README.md) 独立于该适配器定义核心语义。

## Motivation

Instrument 应覆盖后续 pass 生成的节点，无需反复改写直到收敛。同一套接口还要支持 mock 与删除某个槽贡献。作者应能写简短的 `pipe`，无需实现树遍历或手写 SQL AST。先开放普通 TypeScript operator 与 predicate，再依据使用经验收紧核心。

## Guide-level explanation

TypeScript 作者接口保留普通函数组合：

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

`at` 将集合 operator 提升为对某个槽全部贡献的操作；删除贡献不移除仍有其他用途的组件。当前适配器保持贡献者之间的顺序，允许同一贡献者内部重排；跨贡献者重排会被拒绝，新增条目也必须指向已有贡献者。这些是适配器约束，不是抽象 Module 表示的限制。`replace` 保持模块身份，新依赖与提供物是否兼容由最终验证决定。`when`、`and`、`or`、`not` 组合条件。普通条件读取该步骤的输入，不在后续步骤完成后回头重跑。MVP 不禁止普通 TypeScript 条件，也不要求查询 AST；谓词语法本身不能使任意回调全定义或纯粹。

`decorate` 登记规则。编译器在结构编辑全部结束后选择具体 provision alias，排除 exports 转发的 alias，每条匹配规则对同一 provider 值在 boot 时包装一次。Wrapper 创建的值不成为新的编译目标。Telemetry 演示有类型的成员包装，覆盖在其 pass 之后加入的 provider，插件自己无需递归遍历。

模块通过数据注册 pass：

```json
{ "contributes": { "CompileModule.passes": [{ "id": "telemetry" }] } }
```

插件在 `passes.telemetry` 导出工厂，每次 compile 尝试重新解析。本次重试的工厂和注册都来自实际保留的插件集合。

## Reference-level explanation

### 语义核心

[Pass.lean](../formal/module-model/ModuleModel/Pass.lean) 将 pass 定义为有限序列，只有两种操作和结束标记：

```lean
abbrev Decoration := (Name → Declaration → Bool) × (Code → Code)

inductive Pass where
  | done
  | edit (transform : Module → Module) (next : Pass)
  | decorate (rule : Decoration) (next : Pass)
```

Edit 是纯且全定义的变换。`add`、`filter`、按固定名称的 `remove`、保留身份的 `replace`、`expand` 和命名空间内的 `filterAt` 都是 Module 值上的函数，不另设 pass 变体。内置集合编辑读取有限输入快照；`expand` 拼接回调结果，不遍历自己的输出。条件可以读取当前条目或当前 Module，但仍须满足纯度与全定义前提；检查变化中 Module 的谓词不自动享有固定名称删除的代数律。

`collect` 按顺序执行编辑并积累 decoration 规则。整个组合收集结束后，`materialize` 用同一份最终声明快照测试所有规则，再按规则顺序折叠匹配的配方变换。Wrapper 只改变不透明代码，不改变名称、声明类型和依赖。每个匹配的列表项应用一次，同一规则登记两次就应用两次。Selector 看不到之前的 wrapper，wrapper 输出不成为新目标。因此 instrument 能覆盖后续编辑，无需收敛迭代；但不假设 wrapper 保持应用行为。

`append` 满足组合结合律，`pipe` 折叠该组合。一般而言，`run (append a b) m` **不等于** `run b (run a m)`，因为分开运行会提前 materialize。例如，`b` 中的替换可以丢弃 `a` 已应用的 wrapper；组合执行时，这个 wrapper 会改为选择最终替换结果。每次组合构建只进行一次最终 materialize，全程使用同一种 Module 表示。

### TypeScript 执行

1. 对装配后的原始树建立快照，包括嵌套 manifest 数据；保留不透明代码引用，编译编辑不执行模块工厂。快照保护旧输入与原始声明。
2. 一次性收集注册，重复 id 报错；按 `after` 拓扑排序，以 id 字典序破平局。缺失依赖表示「若存在则排在其后」，成环具名报错。Pass 新建的注册不在本次 compile 调度。
3. 每个 pass 执行一次。内置 operator 复制改变的路径，并按原始子树快照遍历。`add`、`remove`、`replace` 编辑结构，`at` 编辑槽集合。Rewrite 期间失败时，同时丢弃编辑和延后规则。任意 TypeScript `rewrite` 作为开放接口保留，不承诺一般停机。
4. 在最终树上解析 decoration。按完整接口键匹配，用有类型的 handle 编写 wrapper，不依赖 `Function.name`。Exports 转发已包装的子节点值，不重复包装。规则按 pass/operator 顺序组合，后者在外层。
5. 最终统一验证并保留诊断来源，中间态允许语义失配。图验证与 TypeScript 赋值检查分别进行；类型兼容沿用 PRFC-0001 的声明渲染机制。
6. Boot 已验证候选。重装配和恢复都从原始声明开始，不复用已装饰的输出作为源树。

MVP 保留原始 `rewrite` 开放接口。内置 operator 的来源包括 pass id、operator 位置与名称、受影响模块/槽、删除和供应插件。自定义回调保守归因到 pass。源码位置、条件判断的控制来源可以后续细化，不得宣称唯一因果归责。诊断和异常路径是实现要求，不在当前纯 Lean 模型中；树节点、alias、exports 与贡献集合到具名声明的翻译，也仍需建立 refinement 对应。

### 诊断与 profile

诊断来源独立于 debug 计时收集。最终错误报告受影响关系与相关 operator，包括删除者。延迟 selector 或 wrapper 失败时报告对应 operator，候选被拒绝，best-effort 恢复排除供应插件后重建。Pass 修改别人的节点时优先归因给供应 pass，再回退到模块归属；best-effort 排除供应插件后从原始声明重建。

`PENGUIN_MODULE_COMPILE_DEBUG=1` 收集 pass 耗时与最终树。优化依据 profile，不追求墙钟时间定理。接口数不足以约束编译成本，分别记录 requirement/候选对数、中间结果规模、声明生成量与 tsc 工作量，不因目录里存在接口就枚举全部接口对。

模型的操作步数恰好是有限 pass 的长度，不包含回调执行。最终 Module 有 `n` 个声明、`d` 条延后规则时，直接 materialize 执行 `n × d` 次谓词调用，并对每次匹配执行一次配方变换。快照展开的输出大小等于各回调输出长度之和。这些陈述都不约束回调内部工作、生成结果的增长、provider 搜索或 tsc。评审工作负载以 5,000 条接口目录为初期目标，远期为 100,000 条；这是工作负载参数，不是实测容量或 Module 声明数。先分别 profile 这些成本，再决定索引、共享或增量执行。

### 模型证明范围

Lean 4 草稿仅针对模型。定义、外部 TypeScript 假设与 [Laws.lean](../formal/module-model/ModuleModel/Laws.lean) 分开，后者的定理证明暂用 `sorry`。TypeScript 检查器契约与准入陈述见 PRFC-0001。草稿构建成功只检查定义和定理陈述，不代表证明完成或 TypeScript 实现正确。

`Evaluates` 独立于 `collect` 解释器给出关系式执行语义。拟证明的定律包括：对任意有限 Module 和 Pass 存在有限求值，结果与操作步数唯一，求值与 `collect` 一致，以及组合满足结合律。不设 fuel 或输入规模上限。回调必须是纯且全定义的函数，定理不证明任意 TypeScript rewrite、selector 或 wrapper 停机。集合 operator 遍历快照，pass 求值则递减剩余有限序列；允许 Module 增长，不要求其大小下降。

其余陈述覆盖纯逐项 filter 融合、固定名称删除的代数律、替换与命名空间局部性、slot 从 N 到 N−1 的删除、精确展开大小、最终选择与规则顺序、后续编辑覆盖、被删除目标不再出现，以及 decoration 保持声明契约。Decoration 保持 `Valid` 是因为它只改变不透明代码，不代表 wrapper 行为已经证明安全。任意编辑不保证保持 `Valid`，也不保证交换律。Module 值相同不表示诊断历史相同，模型尚未包含历史。

插件安装、卸载与严格缩小集合的重试见 PRFC-0003。来源有效性、异常、park/load、保留与恢复需要补充建模。将来若需验证实现，先建立作者适配器及回调与核心语义的对应，再采用可执行的已验证核心或验证指定变换的检查器。输出类型合法不证明作者要求的删除或替换已经执行。

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

### v2.1.0

- Added：有限 edit/decorate 语义、回调全定义前提、快照遍历，以及跨组合统一进行最终 materialize。
- Updated：Lean 草稿的定理范围、精确 pass 操作步数与 profile 维度，区分接口目录大小和模块大小。
- Clarified：保留普通 TypeScript 回调；来源、运行时副作用与适配器 refinement 不在模型内，所有定理暂用 `sorry`。

### v2.0.0

- Updated：未合并的 module-pass 草稿从 PRFC-0021 调整为 PRFC-0025；PRFC-0021 已用于 Distros。
- Updated：不可变 pipeable 编辑、最终目标 decoration、插件 pass 工厂、诊断来源、换代重放与仅证明模型的范围。
- Removed：以注册顺序破平局，以及 instrument 依赖反复改写的语义。

### v1.0.0

- Added：manifest 注册、模块树 compile 管线、boot 接缝与可选 debug 输出。
