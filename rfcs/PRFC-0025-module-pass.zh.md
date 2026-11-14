# PRFC-0025 Module Pass：boot 前的不可变 operator

[English](PRFC-0025-module-pass.md)

- Feature Name: `module_compile`
- Start Date: 2026-10-25
- Rev: v2.2.0

## Summary

Pass 在装配后的 Module 声明快照上组合编辑和延后 decoration，属于包含 Decorator、签名投影和依赖检查的完整 [Module 机制](PRFC-0001-module.zh.md)。结构编辑产生新快照，延后的 Decorator 在最终结构结果上选择目标，验证通过后才 boot。[Plugin](PRFC-0003-plugin.zh.md) 定义哪些声明与 pass 参与构建。

## Motivation

Instrument 应覆盖后续 pass 生成的节点，无需反复改写直到收敛。同一套接口还要支持 mock 与删除某个槽贡献。作者应能写简短的 `pipe`，无需实现树遍历或手写 SQL AST。先开放普通 TypeScript operator 与 predicate，再依据使用经验收紧核心。

## Guide-level explanation

作者接口保留普通函数组合：

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

### 编辑与 Decorator

Pass 是结构编辑和延后配方 Decorator 的有限序列。Decorator 按 [Module](PRFC-0001-module.zh.md) 的定义变换单个声明；普通声明 Decorator 在作者应用它时执行，`decorate` 则登记 selector 与只变换配方的 Decorator，在最终结构结果上执行，不改变名称、提供类型或需求。两者使用相同的声明语义，应用时机不同。

Edit 是纯且全定义的变换。`add`、`filter`、按固定名称的 `remove`、保留身份的 `replace`、`expand` 和命名空间内的 `filterAt` 都是 Module 值上的函数，不另设 pass 变体。内置集合编辑读取有限输入快照；`expand` 拼接回调结果，不遍历自己的输出。条件可以读取当前条目或当前 Module，但仍须满足纯度与全定义前提；检查变化中 Module 的谓词不自动享有固定名称删除的代数律。

`collect` 按顺序执行编辑并积累 decoration 规则。整个组合收集结束后，`materialize` 用同一份最终声明快照测试所有规则，再按规则顺序折叠匹配的配方变换。Wrapper 只改变不透明代码，不改变名称、声明类型和依赖。每个匹配的列表项应用一次，同一规则登记两次就应用两次。Selector 看不到之前的 wrapper，wrapper 输出不成为新目标。因此 instrument 能覆盖后续编辑，无需收敛迭代；但不假设 wrapper 保持应用行为。

`append` 满足组合结合律，`pipe` 折叠该组合。一般而言，`run (append a b) m` **不等于** `run b (run a m)`，因为分开运行会提前 materialize。例如，`b` 中的替换可以丢弃 `a` 已应用的 wrapper；组合执行时，这个 wrapper 会改为选择最终替换结果。每次组合构建只进行一次最终 materialize，全程使用同一种 Module 表示。

### 编译

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

调度操作步数恰好是有限 pass 的长度，不包含回调执行。最终 Module 有 `n` 个声明、`d` 条延后规则时，直接 materialize 执行 `n × d` 次谓词调用，并对每次匹配执行一次配方变换。快照展开的输出大小等于各回调输出长度之和。这些陈述都不约束回调内部工作、生成结果的增长、provider 搜索或 tsc。评审工作负载以 5,000 条接口目录为初期目标，远期为 100,000 条；这是工作负载参数，不是实测容量或 Module 声明数。先分别 profile 这些成本，再决定索引、共享或增量执行。

### 组合与停机契约

有限组合在回调纯且全定义时，对任意有限输入都有有限且确定的求值，不依赖 fuel 或声明数量上限。集合 operator 遍历输入快照，pass 调度消耗剩余序列。编辑可以增加输出，新条目不自动回到生成它们的 operator。保留任意 TypeScript 回调，但作者须分别论证其停机与纯度。

纯逐项 filter 可以融合。按固定身份选择的删除幂等且可交换；替换保留身份与位置；slot 内的局部筛选不改变其他 slot 和组件。读取变化中装配结果的谓词不自动享有固定身份删除的定律。一般编辑不保证交换律或合法性，合法性在组合完成后检查。

最终配方 decoration 保持声明契约，因而不改变其合法性；它覆盖后续编辑新增且匹配的声明，保留规则顺序，并排除已删除目标。它不保证 wrapper 的行为。声明相等也不表示诊断历史相同，结构结果相同时仍保留 operator 来源。

插件重建、重试推进与运行时交接遵循 [Plugin](PRFC-0003-plugin.zh.md)。Pass 调度有限不约束 import、migration、运行时副作用或 TypeScript 检查的耗时。

## Drawbacks

冻结快照和来源记录有成本，延后规则需要最终选择阶段。任意回调保留 MVP 灵活性，也限制停机与纯度保证。实例构造必须与声明装配分开，boot 必须消费最终验证确认的布线选择。

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

在代表性接口目录上 profile 后，再决定增量执行与查询优化。未来的变换检查器可以在最终类型合法之外验证指定编辑；只接受合法类型结果不足以说明指定删除或替换确实发生。

## Changes

### v2.2.0

- Updated：在 Module 机制内关联普通声明 Decorator 与延后配方 decoration。
- Updated：独立于证明工具陈述组合、遍历与停机契约，引用限定为 RFC 文档。

### v2.1.0

- Added：有限 edit/decorate 语义、回调全定义前提、快照遍历，以及跨组合统一进行最终 materialize。
- Updated：组合契约、精确 pass 操作步数与 profile 维度，区分接口目录大小和模块大小。
- Clarified：保留普通 TypeScript 回调，纯度、停机、来源与运行时副作用各有责任。

### v2.0.0

- Updated：未合并的 module-pass 草稿从 PRFC-0021 调整为 PRFC-0025；PRFC-0021 已用于 Distros。
- Updated：不可变 pipeable 编辑、最终目标 decoration、插件 pass 工厂、诊断来源、换代重放与停机假设。
- Removed：以注册顺序破平局，以及 instrument 依赖反复改写的语义。

### v1.0.0

- Added：manifest 注册、模块树 compile 管线、boot 接缝与可选 debug 输出。
