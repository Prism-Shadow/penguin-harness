# PRFC-0022 RFC Invariants：一个永久节，写下必须一直成立的性质

[English](PRFC-0022-rfc-invariant.md)

- Feature Name: `rfc-invariants`
- Start Date: 2026-10-23
- PRFC PR: none yet (native to this repository)
- Implementation PR: —（本 RFC 落地后由它自己的实现 PR 承载）

## Summary
[summary]: #summary

本 RFC 给 PRFC 的文档形状增加一个可选的节 `## Invariants`。每条 invariant 是一条有名字的声明：一句用这份 RFC 自己的词汇写成的自然语言句子，加一小段解释。声明说的是这份设计必须一直保持的性质，后来的 RFC、实现与修订都拿它当检查项。没有这类性质的 RFC 省略这一节，文档照样完整。

## Motivation
[motivation]: #motivation

### 设计里那些必须一直成立的性质需要一句可引用的话

一份 RFC 记下一个设计决定：机制是什么、各部件怎么配合、边界在哪里。读完之后，读者能说出这次改了什么；至于「这条设计必须一直成立的是什么」，它只散落在描述机制的散文里。

需要引用这句话的场合很具体。后来的 RFC 要改同一条机制，得先核对它有没有推翻既有承诺；一次实现要判断某个取舍有没有越界；一次修订要交代自己动了哪条承诺。这三件事今天都要重读原文再推断，推断的结论通常留在讨论里，下一份 RFC 读不到。

### 一个具体的例子

[PRFC-0021-distros](./PRFC-0021-distros.zh.md#guide-level-explanation) 固定了发行通道的词表：六条通道，每条回答同一组四个侧面。后来出现一种新的发行方式时，它作为一条新通道加入，并回答这四个侧面。这条要求今天只写在 distros 那份 RFC 的正文里；一份新写的 RFC 若只加通道、不回答侧面，没有一句可以引用的话来说明它破坏了什么。把这类性质写成有名字、可引用的条目，就补上了这处缺口。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 一条 invariant 是一句声明

一条 invariant 是这份设计必须一直保持的性质，用 RFC 自己的词汇写成一句话。它是一份契约：后来的 RFC、实现与修订拿它当检查项。它与实现无关——换掉实现这条机制的每个文件，这句话照样成立。

### 条目的形状

每条 invariant 写成一个小节：一个名字，一句 blockquote 里的声明，一段解释。

下面是一条假设的条目，用来示例形状：

```markdown
### Type relationships survive transforms

> 无论经过哪种变换，[`Module`](./PRFC-0001-module.zh.md#三个原语) 仍然保持正确的类型关系。

<描述——这条性质断言什么>
<解释——在这份 RFC 定义的概念里怎么读>
<原因——失去这条性质，这份 RFC 丢什么>
```

声明的句式是「无论发生哪类变更，哪个概念仍然怎样」。它要能整句被引用：贴进一条评论、一份后续 RFC 的动机、或一次修订的说明里。

### 什么样的陈述能成为 invariant

三条判据：

1. **说的是概念。** 条目里每处引用都落在某份 RFC 定义了该概念的节上。`Module` 是 [PRFC-0001](./PRFC-0001-module.zh.md#三个原语) 定义的概念，可以引用；某个实现文件里的同名类型不能引用，读者无法从设计面核对它。
2. **重要。** 破掉这条性质，这份 RFC 的目的就丢了。只是复述机制、破掉也一切照旧的陈述，不收。
3. **扛得住实现替换。** 把实现这条机制的每个文件都换掉，性质照样成立。一次重构就能破坏的陈述属于设计细节，不收。

三条判据之外，一条 invariant 还要能在设计与实现的过程中被当成一个问题来回答：「这个设计保住它了吗？」

### 可选是设计的一部分

一份代码改动未必带来值得永久保留的性质。没有这类性质的 RFC 省掉这一节，文档照样完整。强制每份都写，只会产出复述机制的空话；这一节的价值来自稀缺。

### 后来的 RFC 怎么对待既有 invariant

后来的 RFC 先按既有 invariant 核对设计：符合就继续。要改掉某条承诺，就在自己的正文里具名退役它——写清退役哪份 RFC 的哪条 invariant、为什么。退役引发被引 RFC 升一个修订，并把这次退役记进它的 `## Changes`。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 节的位置

`## Invariants` 位于 `## Reference-level explanation` 与 `## Drawbacks` 之间，并带锚点标记行 `[invariants]: #invariants`。读者先读完机制，再读到关于它什么必须一直成立。

### 条目的精确形状

每条 invariant 一个 `### <invariant name>`，名字用这份文档的语言。声明是 blockquote 里的一句话，以它所针对的那类变更为开头，例如：「无论一条通道怎样重塑，……仍然……」。正文一到数段，覆盖三件事，顺序不限：**description**（断言什么）、**explanation**（在这份 RFC 定义的概念里怎么读）、**why**（失去它会丢什么）。正文可以引用 RFC、可以谈实现的现状；声明句本身只谈概念。

### 引用规则

链接只指向 RFC 锚点，形如 `./PRFC-NNNN-slug.zh.md#anchor`，每个锚点在目标文档里真实存在。引用不指向实现的源文件、路径或标识符。同一批落库的 RFC 互引时，按落库后可读的形状书写。

### 退役

一条 invariant 只能以具名的方式退役：在声明它的那份 RFC 的一次修订里写明退役哪一条、为什么，并记在该 RFC 的 `## Changes` 下，同时升该 RFC 的版本号。别处不能注销一条 invariant。

### 本 RFC 对 RFC 面的改动

`TEMPLATE.md` 在 `## Reference-level explanation` 与 `## Drawbacks` 之间增加 `## Invariants` 节位，附条目形状与三条判据。这份文档本身按新形状写成，带两条 invariant。已落地的 RFC 不要求回溯补写。

## Invariants
[invariants]: #invariants

### 引用落在概念上

> 无论实现怎么安排，一条 invariant 引用的仍然是 RFC 所定义的那个概念。

引用规则是这一节要固定下来的性质。读 invariant 的人可能不在设计做出的现场；每处引用都是他们到达概念的路径，指向实现的引用递给他们一个移动靶。一旦放开实现级引用，这一节就会漂移成「代码今天怎样就怎样说」。

### 约束后来的 RFC

> 无论后来的 RFC 怎样重塑一条机制，它所构建于其上的那些 RFC 的 invariant 仍然成立，除非那份 RFC 具名退役其中一条，且声明它的 RFC 记下了这次退役。

约束力把 invariant 与观察区分开。一份与既有 invariant 矛盾的后续 RFC 也可能是对的——设计确实会被推翻——但矛盾必须写下来、认领，并记在声明它的 RFC 名下，这样 harness 实际承诺了什么才一直可知。

## Drawbacks
[drawbacks]: #drawbacks

这一节给写作与阅读都添了一道成本，弱的 invariant 还会稀释它的分量。三条判据把住入口，判断仍要读者来做。退役机制给了后来的 RFC 逐条撤掉承诺的通道；这是有意的设计——撤不掉的契约会烂成没人读的契约，而沉默的破坏正是这一节要终结的形态。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**独立小节**：必须存续的性质需要一个稳定锚点，后来的文档才能像引用一节那样引用它；机制段落里的散文没有锚点。

**blockquote 一句话**：声明可以整句引用，断言与解释在视觉上分开。

**可选**：强制会产出复述机制的空话，价值来自稀缺。

**自然语言**：设计面是散文，性质要能被读者判断。

**考虑过的其他做法**：一份跨 RFC 的独立性质登记文档，失去就近性——读 PRFC-0001 的人应当在 PRFC-0001 里遇到它的性质；测试断言，绑在实现上，正好是 invariant 不该有的依赖；把性质写进 changelog，changelog 记变化，记不住永恒。

## Prior art
[prior-art]: #prior-art

形式化方法（TLA+、Alloy）把性质与实现分开，用性质检验实现；本 RFC 借这个分离，不借形式化。Eiffel 的 Design by Contract 在边界上检验对象不变量，是「设计每次被读到时都被检验」的近亲。C++ 标准的复杂度承诺是规约层写下的性质，每种实现都必须一直保持。Rust 的稳定性分级回答同一个问题——承诺什么、承诺多久——答案是一节可以引用的文档。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

几处细节留待实现或后续修订。

- 已落地的 RFC 是否回溯补 invariant；本 RFC 不强制，每份都算它自己的一次修订。
- 引用形状能否被工具检查：锚点存在性可以，重要性与抗实现替换两条不能。
- 已退役的 invariant 除被引 RFC 的 `## Changes` 外，要不要在索引里留一列。

## Future possibilities
[future-possibilities]: #future-possibilities

工具可以只查引用形状：不引实现文件、锚点全部可解析。这一节的形状也可以推广到其它承诺长期稳定的面——插件契约、机器协议——只要它们长出 RFC 形态的文档。

---

## Changes

### v1.0.0

- 初始版本（草案，原生于此仓库）。
