# Module model and proofs

A Lean model of declarations, operators, passes, plugin replay, and local hot reload.
Every theorem has a complete proof. A successful build checks those proofs relative
to the external interface below; it does not establish correctness of the TypeScript
implementation.

Run `lake build` in this directory with the pinned Lean toolchain. The package uses
Lean's standard library and has no third-party dependencies.

The specifications are [Module](../../PRFC-0001-module.md),
[Module Pass](../../PRFC-0025-module-pass.md), [Plugin](../../PRFC-0003-plugin.md),
[HMR](../../PRFC-0002-hmr.md), and [Agent State](../../PRFC-0015-agent-state.md).
They define the complete mechanism, including authoring forms, signature projection,
resolution and runtime assembly. This package abstracts its declaration operations;
it does not redefine the mechanism as only a list. Every model file cites its governing
RFC sections in a comment. The [paper](../docs/module.typ) explains the abstraction,
theorems and remaining obligations; [build instructions](../README.md) cover both tools.

## Concepts

| Concept | Definition |
| --- | --- |
| Module | A finite, ordered sequence of qualified names and declarations. Each declaration has a type, named requirements and an opaque code recipe. |
| Operator | A pure transformation of one declaration, applied in logical composition order. Identity and position are held by the Module. |
| Pass | A finite composition of declaration edits and deferred recipe operators. |
| Plugin | A name associating declarations with a pass. A fixed catalog defines precedence and revisions; enabled names select its members. |
| Replay machine | Scratch declarations, pending instructions, and accumulated deferred rules. Every retry starts from the retained source selection. |
| HMR generation | A plan and its immutable code roots. Phase images, running Tasks, and resource references determine which artifacts must remain stored. |

A declaration is the entry in a Module, not another lifecycle object. A Component is
a declaration whose code creates a component. Names determine scopes. A slot can be
represented by the declarations directly in one namespace: `Module.members` is a
view, and `filterAt` edits that view without touching other names. Source declarations,
intermediate results and accepted results all have the same `Module` type. `Valid`
is a predicate on that type.

Order is meaningful for contributions. Unique names are required by final validity;
intermediate edits may contain duplicate names, missing targets or incompatible types.
`lookup` returns the first match, so uniqueness must be checked before admission.

This is an abstraction of the RFC mechanism. Dependencies
already name their targets. Implicit provider search, aliases and export syntax must
be translated into that representation; correctness of that translation is not part
of this draft. A declaration may depend on names in its own namespace and enclosing
namespaces. Dependencies must admit a decreasing natural-number rank, allowing a
startup order without cycles.

`Operator` belongs to the domain model, alongside Module, Pass and Plugin. `withType`,
`require` and `recipe` refine a declaration's contract, dependencies and code.
`andThen` composes them; `on` applies one at a fixed identity. Class and field annotations
are one notation for declaration construction and operator application. Their parsing, elaboration,
multi-provision expansion and source-language evaluation order are not defined here.
An ordinary operator may change contracts and break validity. Deferred pass rules use
`Operator.recipe`, the same operation restricted to code, with selection on the final
structural snapshot.

`Operator = Declaration → Declaration` and an edit's `Module → Module` type describe
their input and output representations. Neither entails `Module.Valid` for the output.
The final checker judges identities, visibility, compatible dependencies and acyclicity
after all edits and deferred recipe operators have been applied.

## Definitions and assumptions

Read the files in this order:

1. `ModuleModel/External.lean`: uninterpreted TS types, code and compatibility, an
   optional checker answer, and the one external propositional axiom.
2. `ModuleModel/Module.lean`: declarations, scope, edits, validity and a checker using
   an ordinary name list as the proposed startup order.
3. `ModuleModel/Operator.lean`: declaration transformations, composition, application
   at a fixed identity and preservation of contracts.
4. `ModuleModel/Pass.lean`: composition, deferred recipe operators and relational evaluation.
5. `ModuleModel/Plugin.lean`: assembly from a fixed base and the enabled plugin set.
6. `ModuleModel/Basics.lean`: complete proofs of the elementary properties, including
   checker soundness and completeness under completed external comparisons.
7. `ModuleModel/Proofs/Normalization.lean`: the ordered-projection normal form,
   restricted reordering, and a counterexample to separate finalizations.
8. `ModuleModel/Replay.lean` and `ModuleModel/Proofs/Plugin.lean`: compilation steps,
   failed-attempt histories, refinement to clean rebuilding, and undo counterexamples.
9. `ModuleModel/HMR.lean` and `ModuleModel/Proofs/HMR.lean`: local update transitions,
   retention and plan invariants, and token-guarded cleanup.

The external axiom says that a **completed** type-check answer agrees with the
compatibility relation in one fixed environment. `none` represents an unavailable
answer. The oracle has no executable implementation here: `verify` is noncomputable
relative to it. No termination or completeness of tsc follows from this model, and
no transitivity or other algebraic law is assumed for compatibility. Recipe execution
and the truth of a recipe's declared type are also outside the model. Final validity
concerns declarations and dependencies, not runtime type safety.

Callbacks are pure, total Lean functions. The built-in edits use finite input
snapshots; generated entries are not revisited. An arbitrary TS callback needs a
separate refinement argument before it can be treated as one of these functions.
`Pass.Evaluates` observes the structural result and deferred rules. Its counted
refinement, `Pass.EvaluatesIn`, also records the number of scheduled instructions;
`Evaluates` existentially hides that count. The termination statement counts pass
operations, not callback work or wall time.

Deferred operators have an explicit application boundary. Selectors see the final
structural declarations, and matching rules transform each recipe in order. Each
list occurrence is applied once; registering the same rule twice applies it twice.
Selectors do not observe earlier wrappers. Consequently, running two passes
separately is generally different from composing them and running the composition.
There is no automatic fixed-point iteration and no assumption that a wrapper
preserves application behavior.

## Basic properties

- Editing: filter fusion; fixed-name deletion idempotence and commutativity;
  replacement identity; locality; slot filtering and removal of exactly one member;
  exact expansion cardinality.
- Validation: sound admission; completeness when answers are available; resolved,
  visible and compatible dependencies; absence of cycles; refusal of unanswered
  questions; preservation of the current module on rejection.
- Operators: associative composition with identity; composition at a fixed name;
  name preservation and locality; recipe and composition contract preservation;
  validity preservation conditional on unchanged contracts.
- Passes: existence and uniqueness of finite evaluation; agreement of the interpreter
  and the relational meaning; associative composition; final selection, order and
  coverage of deferred recipe operators; preservation of declared contracts.
- Plugins: equality under equal enabled sets; fresh install/uninstall round trips;
  idempotent install/uninstall; absence of retired plugins from scheduling; retention
  while another request remains; well-founded retries under strict retirement.

Plugin names are unique in a valid catalog; `selection_unique` makes that precondition
explicit. Plugin equivalence fixes the base, catalog, revisions and pure callbacks. It concerns
the rebuilt Module, not equality of a live heap after installation and removal.
Uninstalling a needed provider can produce an invalid candidate; the admission law
then preserves the old module. Retry termination is conditional on strictly reducing
the retained selection, without claiming an optimal selection or specifying a
best-effort policy.

## Main guarantees

`Proofs/Normalization.lean` proves that collection is the fold of the ordered edit
projection paired with the ordered rule projection. Equal projections give equal
results, so their interleaving may vary. Neither edits nor wrappers can be freely
permuted. Introducing a second finalization boundary can change the output.

`Proofs/Plugin.lean` proves that machine steps preserve the meaning of the remaining
computation. Completed runs refine `Plugin.build`, and partial failed attempts do
not affect the final attempt's output. The base, catalog, revisions, and pure
callbacks are fixed. The file also proves that a destructive edit has no general
inverse from its output alone, and that an output's DI graph does not capture every
observation a compile callback can make. Both outputs in the latter counterexample
can satisfy `Module.Valid`.

The output-only inverse result does not refute Cordis 2026: Cordis effects return
per-state inverses that can retain missing information. The paper compares that
approach with retaining original declarations and replaying transformations.

`Proofs/HMR.lean` proves preservation of `Safe` and `ValidPlans` under the protocol's
transitions. New bundles contain their roots and account for direct dependencies;
new resource references must already be reachable. Current, candidate, recovery,
Task, and resource roots all contribute to transitive artifact retention. A failed
recovery keeps the old generation and opaque parked snapshot in a degraded state.
Collection removes only unreachable artifacts. A separate registry result proves
that an old disposer with a different token cannot remove a new registration.

These are safety results. They assume immutable artifact identities, complete
reference tracking, and fresh registration tokens. Lifecycle success, eventual
collection, JavaScript heap safety, and correctness of state migration are not proved.
State shape equality alone does not establish behavioral compatibility. Retaining
code also does not establish that a disposed service remains callable by old Tasks.

The target protocol requires candidate verification before disposal. The accompanying
TypeScript implementation still compiles the candidate during successor boot after
old-tree disposal, so that stronger ordering has not been established there. Code
import, factory freshness, cache behavior, diagnostic provenance, and actual runtime
resource lifetimes remain refinement obligations. Package upload and distribution
are outside this local HMR model. No claim is made about structural sharing in a
particular persistent representation.
