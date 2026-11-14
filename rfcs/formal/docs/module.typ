#import "@preview/faithful-acmart:0.2.0": *

// Governing specifications: ../../PRFC-0001-module.md,
// ../../PRFC-0003-plugin.md and ../../PRFC-0025-module-pass.md, revision v2.2.0.
// POPL/PACMPL uses acmsmall. This is a design draft, not a published ACM article.
#show: acmart.with(
  format: "acmsmall",
  font-size: 10pt,
  review: true,
  nonacm: true,
  screen: false,
  print-acm-reference: false,
  authors-addresses: none,
  doi: none,
  isbn: none,
  title: "Declarations, Decorators, and Replay in a Module Mechanism",
  subtitle: "A model and theorem-statement draft for PenguinHarness",
  short-title: "Module Semantics: Design Draft",
  authors: (),
  abstract: [
    PenguinHarness assembles components from declarations, decorators, interface
    signatures, dependency resolution, compile passes, and runtime lifecycle rules.
    Instrumentation must cover declarations introduced by later passes, while mocks,
    contribution removal, and plugin uninstallation require structural changes.
    We specify a finite declaration model with ordinary decorators and deferred
    recipe decoration. Edits may temporarily violate contracts; admission checks the
    final result using an external TypeScript compatibility relation. Plugin changes
    rebuild from the original declarations rather than invert prior edits. The
    accompanying Lean draft states algebraic, admission, termination, and replay laws.
    All theorem proofs remain deferred. This paper distinguishes those statements
    from the additional obligations for source elaboration, diagnostics, park/load,
    and runtime recovery.
  ],
  keywords: ("module systems", "decorators", "rewriting", "plugin reconfiguration", "Lean"),
)

#show raw.where(block: true): set block(breakable: false)
#show table: set par(justify: false)

= The mechanism and the modeling boundary

The Module mechanism is the complete path from author declarations to an assembled
runtime. An author declares an Interface contract, a Component implementation, or a
Module scope. Decorators attach and refine those declarations. A generator projects
their signatures into data; resolution chooses visible providers; compile passes
transform declaration snapshots; verification checks the result; and boot creates
and connects instances. Plugins supply declarations and passes to that same path.
The normative design is recorded in the Module, Plugin, and Module Pass RFCs
#cite(<rfc-module>, <rfc-plugin>, <rfc-pass>).

The model focuses on declaration operations within this mechanism. It uses Module,
Decorator, Pass, and Plugin as domain concepts. Names and declarations are data
inside those concepts. A source snapshot, an intermediate snapshot, and an accepted
snapshot use the same Module representation. Validity is a predicate, not another
kind of module. Runtime instances and their resources are not declaration snapshots.

This distinction matters for both expressiveness and claims. Mocking replaces a
recipe and possibly its contract. Removing a tab filters an ordered contribution
view. Instrumentation transforms recipes after structural edits finish. None of
these operations needs a fixed-point rewrite scheduler. Conversely, a law about
declaration replay cannot restore an open socket or undo an external write.

*Draft status.* The Lean definitions typecheck, but every theorem body in
`ModuleModel/Laws.lean` intentionally uses `sorry`. All statements labeled
“Proposed law” below are obligations for review, not completed proofs. The external
type-check contract is stated separately; it is not a substitute for those proofs.
No claim about the correctness of the TypeScript implementation follows from the
draft building successfully.

#block(breakable: false)[
== Decorators are domain operations

The RFC's class notation is one way to express declaration construction and
decoration. For example:

```ts
@Interface()
abstract class Store {
  abstract read(key: string): Promise<string>;
}

@Component()
class SessionService {
  @Use() private readonly store!: Store;
}
```
]

The semantic operation is to declare a component and attach its required contract.
It is not intrinsically a TypeScript decorator. The language's annotation syntax,
static signature extraction, and annotation evaluation order must implement that
operation. The model therefore defines `Decorator` next to `Module`, and uses the
same declaration transformations inside passes. It does not model the TypeScript
parser or infer a provider from the field above.

#figure(
  tabular(
    columns: (1.15fr, 2.2fr, 2fr),
    align: left,
    toprule(),
    [RFC surface], [Declaration meaning], [Additional obligation],
    midrule(),
    [Interface], [A contract parameter], [Project the correct signature snapshot],
    [Component / Module], [Recipes and scoped entries], [Elaborate class roles and multiple provisions],
    [Decorator], [A declaration transformation], [Preserve the specified logical order],
    [Use / Provide / Bind], [Requirements, provisions, contribution entries], [Resolve names, aliases and bindings],
    [Slot], [An ordered namespace view], [Preserve ownership and contribution order],
    [Boot / park / load], [Outside declaration evaluation], [Specify state and resource transitions],
    bottomrule(),
  ),
  placement: none,
  caption: [The Module mechanism and the abstraction used here. The last column is
    not discharged by the current model.],
) <surface-map>

= Declarations, scope, and decorators

// PRFC-0001: Declarations and decorators; Visibility is lexical.
Let $T$ be an uninterpreted domain of contracts and $C$ an uninterpreted domain of
code recipes. A qualified name is a finite list of strings. A declaration is a
record $d = (t, R, c)$, where $t in T$, $c in C$, and $R$ is a finite list of
named requirements $(q, t')$. A Module is a finite ordered sequence
$M = [(q_1, d_1), dots, (q_n, d_n)]$.

Names are not required to be unique during editing. Lookup returns the first
matching entry, so final admission must reject duplicates. A well-formed name has
at least one nonempty part and no empty parts. Order remains observable even when
names are unique: a slot view retains contribution order after filtering.

`members(s, M)` selects entries whose parent namespace is exactly $s$.
`visible(o, q)` holds when the parent namespace of $q$ is a prefix of $o$.
This predicate describes names in a declaration's own and enclosing namespaces.
Requirements already name their targets. The RFC's implicit provider search,
outward exports, aliases, and class-tree visibility need an elaboration into these
resolved names. The prefix predicate alone does not establish that elaboration's
correctness and does not replace the RFC's visibility rules.

#definition(name: "Decorator")[
  A Decorator is a pure, total function from declarations to declarations.
  The surrounding Module holds the qualified name and position, so a Decorator
  does not rename or move its target. For decorators $a$ and $b$, write
  $(a ; b)(d) = b(a(d))$ for logical composition, and $I(d) = d$ for identity.
]

The definitions provide `withType(t)` to set the offered contract,
`require(q, t)` to append a named requirement, and `recipe(w)` to transform code
by $w : C arrow C$. The operation `on(q, a, M)` applies $a$ to entries named $q$.
Intermediate duplicates are all transformed; accepted Modules have unique names.
Logical composition order is explicit. A source language whose annotation order
differs must elaborate into this order.

#theorem(title: "Proposed law", name: "Decorator composition and locality")[
  Composition is associative, and $I$ is a left and right identity. Applying
  $a ; b$ at a fixed name equals applying $a$ there and then $b$ there. Application
  preserves the name sequence and lookup at every other name.
]

A decorator preserves contracts when it preserves both the offered type and the
requirements of every declaration. Recipe decorators satisfy this predicate;
composing two contract-preserving decorators also satisfies it. Such decorators
preserve declaration validity. A general decorator may add an unsatisfied
requirement or change an offered type, and therefore has no unconditional validity
preservation law. Contract preservation says nothing about whether a wrapper
preserves application behavior.

== Structural edits

`add` appends declarations. `filter` applies a pure entry predicate to the input
snapshot. `remove` uses a fixed name predicate. `replace` keeps the name and
position while replacing a declaration. `expand` concatenates a finite result for
each input entry, without revisiting generated entries. `filterAt` restricts a
filter to one namespace. Arbitrary pure, total Module transformations can be edits;
the built-in operators expose useful laws without requiring a query-language AST.

#theorem(title: "Proposed law", name: "Editing laws")[
  Pure pointwise filters fuse. Fixed-name removal is idempotent, and two such
  removals commute and equal removal by their union. Replacement preserves names
  and is local to its target. Namespace filtering leaves other names unchanged.
  Removing a present, uniquely named member from a slot of size $N$ leaves $N - 1$
  members. Expansion has output size equal to the sum of the callback output sizes.
]

These premises exclude an adaptive predicate that reads the evolving Module and
changes its decision after another edit. They also exclude side effects whose
number or order is observable. A general pair of edits need not commute. Persistent
data structures can share unchanged storage, but equality and locality of values
do not prove any particular allocation or sharing bound.

= Final verification with an external type checker

// PRFC-0001: The judgment rules; Compilation, verification and runtime assembly.
The model has uninterpreted symbols `Ty`, `Code`, `Compatible` and
`typeCheck : Ty → Ty → Option Bool`. The compatibility relation is directional:
the offered type must satisfy the required type. The environment fixes compiler
options, declaration revisions, and referenced contracts for the comparison.

#definition(title: "External assumption", name: "Completed type-check answers")[
  If `typeCheck offered required = some answer`, then
  `answer = true` if and only if `Compatible offered required`.
  An unavailable answer is `none` and cannot admit a dependency.
]

This is the only external propositional axiom. The checker has no executable oracle
in Lean, so `verify` is noncomputable relative to it. The assumption gives no
termination or completeness theorem for tsc and assumes no subtype algebra. It
also does not establish that executing a recipe produces its declared type.

The implementation contract is to render each side's own declaration snapshot into
TypeScript declarations and ask the corresponding assignment questions. It must
preserve direction and transitive references. Missing declarations, unsupported
rendering, or an unfinished check are not positive answers. Graph validation is
still responsible for resolving providers and detecting ambiguity.

#definition(name: "Validity and admission")[
  `Valid(M)` requires unique well-formed names; every requirement must resolve to a
  visible provider with a compatible offered type; and there must exist a natural
  number rank that strictly decreases from each consumer to its required providers.
  `verify(M, order)` independently checks these constraints using a name list as
  an order witness. Each name occurs once and each provider precedes its consumer.
  Admission selects the candidate only when verification succeeds; otherwise it
  selects the current Module.
]

#theorem(title: "Proposed law", name: "Verification and admission")[
  A verified Module is valid. A valid Module has an accepted order witness when
  all required type questions have answers. Every accepted dependency is resolved,
  visible and compatible; valid Modules have no dependency cycle. An unanswered
  required comparison is rejected. Rejection preserves the current Module, and
  admission preserves validity when the current Module is valid.
]

Intermediate edits need not satisfy `Valid`. Removing a provider can be repaired by
a later edit before the final check. If it is not repaired, diagnostics should name
the consumer, the missing relation, and relevant operators, including the remover.
The implementation retains provenance independently of timing. The current model
does not contain that history, exception paths, or a minimal-cause analysis; these
remain additional obligations under the RFC.

= Passes and final decoration

// PRFC-0025: Edits and decorators; Composition and termination contracts.
A Pass is a finite sequence with constructors `done`, `edit(f, next)`, and
`decorate(rule, next)`. An edit transforms the current Module. A decoration rule
pairs a selector with a recipe transformation; it is applied through
`Decorator.recipe`. Thus ordinary decoration and deferred decoration use the same
domain operation. The restriction to recipes is what preserves declared contracts
at the deferred stage.

`collect(P, M)` performs structural edits in order and accumulates rules.
`materialize(rules, M)` selects all rules against the same final structural
declarations, then folds matching recipe decorators in their recorded order.
The selectors do not observe earlier wrappers. Each matching list occurrence is
applied once: registering the same rule twice applies it twice. A wrapper-created
value is never a fresh compile target. `run` collects and then materializes once.

This semantics supports an instrumentation pass before a later pass that adds or
replaces a provider. The instrumenting rule sees the final provider. A removed tab
contribution has no final target. A mock may change the declaration's contract, which
is checked at final admission, while the later recipe decorator leaves that
declared contract intact.

#theorem(title: "Proposed law", name: "Finite evaluation and composition")[
  For every finite Pass and Module, the independent relation `Evaluates` has a
  finite result. The result, collected rules, and operation count are unique.
  Evaluation agrees with `collect`, and its operation count is the Pass length.
  `append` is associative, and collection over an append threads the structural
  result and concatenates the collected rules.
]

Callbacks are pure, total Lean functions. The remaining Pass sequence is the
decreasing measure; collection operators use finite input snapshots. Module size
may grow and need not decrease. The statement has no fuel limit, but it does not
prove totality of an arbitrary TypeScript callback, selector, wrapper, import or
migration. The relational operation count excludes work inside callbacks.

#theorem(title: "Proposed law", name: "Final decoration")[
  Selection includes exactly the matching rules and preserves their order.
  Materialization preserves names, offered contracts, requirements and validity.
  Each matching rule occurrence transforms the final recipe once. Decoration
  covers targets introduced by later edits, and structurally removed targets
  remain absent.
]

Associative composition must not be confused with separate execution. In general,
`run(append(a, b), M)` differs from `run(b, run(a, M))`. If $a$ decorates a provider
and $b$ replaces it, separate execution can discard the already wrapped recipe.
Combined execution selects the replacement after both passes have been collected.
The intended build therefore has one final materialization boundary.

= Plugin selection and replay

// PRFC-0003: Compile passes and generation changes; Reconfiguration guarantees.
A Plugin has a name, declarations and a Pass. A fixed catalog supplies unique names,
code revisions and precedence. Selection filters that catalog by membership in
enabled names. Request order and duplicate requests do not change the selection.
The effective process selection is the union by membership of Project requests.

`source(base, catalog, S)` appends selected declarations to the base.
`program(catalog, S)` composes selected passes in catalog order, and `build` runs
that program on the source. Every build starts from these inputs. The previous
decorated result is never an input to rebuilding. This also restores another
plugin's contribution if a removed pass had deleted it, without requiring an
inverse for deletion.

#theorem(title: "Proposed law", name: "Selection and installation")[
  Equal enabled membership yields equal rebuilt Modules with fixed base and
  catalog. Installation and uninstallation are idempotent with respect to that
  result. If a name was initially absent, installing and then uninstalling it
  restores the original rebuilt Module. Uninstalled plugins are not selected for
  the next schedule; a remaining Project request retains a known plugin.
]

The freshness premise is necessary: uninstalling a name that was already enabled
does not restore the original selection. Equality also fixes the code revisions,
configuration captured by callbacks, and execution order. Upgrading a package or
disabling only its pass changes the catalog and is not covered by a fixed-catalog
round trip. These are equalities of rebuilt declarations, not live heaps.

Build is distinct from admission. Removing a required provider may produce an
invalid candidate; the admission rule then retains the current Module. A recovery
policy can choose a smaller enabled set and rebuild, but each candidate still needs
verification. The model leaves that policy unspecified.

#theorem(title: "Proposed law", name: "Strict retirement")[
  Let `Retires(next, current)` mean that next's enabled membership is a subset of
  current's and at least one name has been removed. This relation is well founded.
  A chain beginning at $S$ has at most $|"distinct"(S)|$ strict transitions.
]

The bound counts transitions, not the initial attempt. Reordering or deleting a
duplicate request does not decrease the measure. The implementation's best-effort
policy can also drop an original contribution group without removing its plugin;
that step does not satisfy this relation. A proof of the full policy must count
both retained plugin names and retained original contribution groups, and require
every retry to remove an element of those finite sets. No largest usable subset
is promised.

Park/load, runtime publication, Tasks and code artifact reclamation are absent from
the declaration state. A lifecycle proof would need transitions for admission,
handover, boot failure and recovery; contracts for retained state; and an explicit
reachability relation for artifacts. Safe reclamation requires that no active or
candidate generation, Task or recovery snapshot retains the artifact. Eventual
cleanup additionally needs progress assumptions. None of these contracts is
silently assumed by the plugin equations.

= Cost and implementation obligations

The scheduling result establishes a finite number of pass operations; it is not a
wall-clock bound. For $n$ final declarations and $d$ deferred rules, direct
materialization evaluates $n times d$ selectors and performs one recipe
transformation per match. Expansion produces the sum of the callback output sizes.
An arbitrary total callback can still have large cost or output. These counts
guide profiling without imposing a maximum input size.

The requested evaluation workloads use interface catalogs of 5,000 and eventually
100,000 entries. Catalog size is not Module size and does not determine the number
of assignment questions. A profile must separately record requirement sites,
candidate comparisons, intermediate sizes, rendered declaration size, tsc work,
and callback time. The reference list representation is not a production indexing
strategy. This draft presents no benchmark or measured capacity claim.

To transfer the proposed laws to an implementation, first define an elaboration
relation from author declarations and decorators to the model. It must preserve
qualified identities, contribution order, implicit provider choices, export and
alias visibility, and the dependencies introduced by code-bearing contributions.
It must also explain how multiple provisions of one component relate to shared
recipe execution. The current declaration model does not supply that relation.

A subsequent implementation proof could either refine an executable verified core
or validate transformation evidence with a verified checker. Merely checking that
the final declarations are valid is insufficient: the checker must also establish
that the requested removal, replacement or decoration occurred. Signature
projection and the generated TypeScript questions need their own correspondence
argument; the external compatibility axiom only describes completed answers.

#figure(
  tabular(
    columns: (1.2fr, 2.3fr, 1.2fr),
    align: left,
    toprule(),
    [Area], [Lean definitions and statements], [Status],
    midrule(),
    [Contracts], [`External.lean`: completed-answer assumption], [Explicit axiom],
    [Declarations], [`Module.lean`: edits, scope, validity, admission], [Definitions],
    [Decorators], [`Decorator.lean`: composition, named application, contracts], [Definitions],
    [Passes], [`Pass.lean`: collection, materialization, relational evaluation], [Definitions],
    [Plugins], [`Plugin.lean`: selection, rebuilding, strict retirement], [Definitions],
    [Proposed laws], [`Laws.lean`: the statement families above], [Proofs deferred],
    [Elaboration and runtime], [Source correspondence, provenance, park/load, reachability], [Not modeled],
    bottomrule(),
  ),
  placement: none,
  caption: [Verification boundary of this draft. Source files carry comments
    pointing to the governing RFC sections.],
) <proof-map>

= Design context

Pipeable operators use the composition style of RxJS @rxjs; persistent data
structures motivate keeping earlier values available @okasaki. A finite schedule
and final recipe selection avoid making instrumentation coverage depend on rewrite
convergence. Lean provides a language in which the finite definitions and the
proposed statements can be checked together @lean4. These choices do not require
proving TypeScript's type system internally, or assuming a runtime effect can be
reversed by replaying declarations.

The normative RFCs describe the mechanism and its contracts. This paper and the
Lean comments refer to those specifications; they record what the abstraction
covers and what remains to be established. The next proof work should address the
reviewed statements and the elaboration relation before expanding claims to
runtime handover or implementation correctness.

#bibliography("module.bib")
