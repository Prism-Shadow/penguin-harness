# PRFC-0025 Module Pass: immutable operators before boot

[中文版](PRFC-0025-module-pass.zh.md)

- Feature Name: `module_compile`
- Start Date: 2026-10-25
- Rev: v2.1.0

## Summary

A Pass is a finite composition of edits to a Module and deferred decorations. Edits produce another value of the same Module type; decoration rules select their targets from the final structural result. Final verification precedes boot. [Module](PRFC-0001-module.md) defines declarations and validity; [Plugin](PRFC-0003-plugin.md) defines selection and rebuilding. Together they form the semantic core. The TypeScript tree adapter supplies pipeable authoring operators, manifest registration and plugin factories; the [Lean draft](../formal/module-model/README.md) specifies the core independently of that adapter.

## Motivation

Instrumentation must cover nodes produced by later passes without running rewrites to convergence. The same surface must support mocks and deleting a contribution from a slot. Authoring should look like a small `pipe` expression; authors should not implement tree traversal or serialize a SQL AST. Begin with ordinary TypeScript operators and predicates, then restrict the supported core where experience justifies it.

## Guide-level explanation

The TypeScript authoring surface keeps ordinary function composition:

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

`at` lifts a collection operator over the contributions to one slot. Removing a contribution leaves its owner component available for other uses. The current adapter preserves contributor order and permits reordering within one owner; an edit that reorders owners is rejected. New entries must name an existing contributor. These are adapter constraints, not restrictions on the abstract Module representation. `replace` preserves module identity; final verification decides whether its new dependencies and provisions fit. `when`, `and`, `or` and `not` express conditions. Ordinary conditions read the input at that step; they are not retroactively re-evaluated. The MVP does not ban ordinary TypeScript conditions or require a query AST; predicate syntax alone cannot make arbitrary callbacks total or pure.

`decorate` records a rule. The compiler selects concrete provision aliases only after all structural edits, excludes aliases forwarded through exports, and materializes one wrapper per matching rule and provider value at boot. Wrapper-created values never become new compile targets. Telemetry demonstrates typed method wrapping, including providers added after its pass, without recursive walks in the plugin.

A module registers its pass as data:

```json
{ "contributes": { "CompileModule.passes": [{ "id": "telemetry" }] } }
```

Its plugin exports the factory in `passes.telemetry`. Factories are resolved anew per compile attempt. All factories and registrations participating in a retry come from the retained plugin selection.

## Reference-level explanation

### Semantic core

[Pass.lean](../formal/module-model/ModuleModel/Pass.lean) defines a finite sequence with two operations and an end marker:

```lean
abbrev Decoration := (Name → Declaration → Bool) × (Code → Code)

inductive Pass where
  | done
  | edit (transform : Module → Module) (next : Pass)
  | decorate (rule : Decoration) (next : Pass)
```

An edit is a pure, total transformation. `add`, `filter`, fixed-name `remove`, identity-preserving `replace`, `expand` and namespace-local `filterAt` are functions on Module values, not additional pass variants. Built-in collection edits inspect their finite input snapshot; `expand` concatenates the callback results without visiting its own output. Conditions can inspect the current entry or current Module. They do not weaken the totality and purity preconditions, and predicates that inspect a changing Module do not inherit the algebra of fixed-name removal.

`collect` applies edits in order and accumulates decoration rules. After the entire composition is collected, `materialize` tests every rule against the same final declaration snapshot and folds the matching recipe transformations in rule order. A wrapper changes only opaque code; names, declared types and requirements stay fixed. Each matching list occurrence applies once, so registering a rule twice applies it twice. Selectors do not see earlier wrappers, and wrapper output never becomes another target. This gives instrumentation coverage of later edits without convergence iteration, but assumes no preservation of application behavior by a wrapper.

`append` composes passes associatively; `pipe` folds that composition. In general, `run (append a b) m` is **not** `run b (run a m)`: separate runs materialize too early. For example, a replacement in `b` can discard a wrapper already applied by `a`; in the composition that wrapper instead selects the final replacement. There is one final materialization per composed build, using the same Module representation throughout.

### TypeScript execution

1. Snapshot the assembled source tree, including nested manifest data. Opaque code references are retained; compiler edits never execute module factories. The snapshot protects earlier inputs and source declarations from mutation.
2. Collect registrations once. Duplicate ids are errors. Topologically order `after` dependencies with lexical id order for ties; a missing dependency means “after it, if present”. Cycles are named errors. Pass-created registrations do not schedule work in this compile.
3. Execute each pass once. Built-in operators copy changed paths and preserve the original child traversal snapshot. `add`, `remove`, `replace` edit structure; `at` edits a slot collection. A failure during rewriting discards both edits and deferred rules. Arbitrary TypeScript rewrites remain an escape hatch and carry no general termination guarantee.
4. Resolve decoration rules against the final tree. Match fully qualified interface keys, with typed handles for wrapper authoring; do not rely on `Function.name`. Exports forward the decorated child value instead of wrapping it again. Rules compose in pass/operator order, later wrappers outside earlier wrappers.
5. Verify the final tree and retain diagnostic origins. Intermediate semantic mismatches are permitted. Graph validation and TypeScript assignment checks are distinct; TypeScript compatibility uses the declaration renderer described by PRFC-0001.
6. Boot the verified candidate. Reassembly and recovery start from original declarations, never from a previously decorated result.

The MVP retains the existing raw `rewrite` escape hatch. Built-in operator provenance includes pass id, operator position/name, affected module/slot, deletion and plugin ownership. Custom callbacks receive conservative pass-level attribution. Source locations and predicate-control lineage can be enriched later; diagnostics must not claim unique causal blame. These diagnostics and exception paths are implementation requirements outside the current pure Lean model. Translating tree nodes, aliases, exports and contribution collections into named declarations also remains a refinement obligation.

### Diagnostics and profiling

Diagnostic provenance is collected independently of debug timing. Final errors report the affected relation plus relevant operators, including removers. A deferred selector or wrapper failure names its operator; the candidate is rejected and best-effort recovery rebuilds without the supplying plugin. A pass modifying another plugin's node is attributed to the supplying pass before falling back to module ownership; best-effort retries exclude the supplying plugin and rebuild from original sources.

`PENGUIN_MODULE_COMPILE_DEBUG=1` collects pass timing and the final tree description. Profiling, rather than a wall-clock theorem, guides optimization. Interface count alone does not bound compilation: record requirement/candidate counts, intermediate sizes, generated declaration size and tsc work separately. Do not enumerate all interface pairs merely because they exist in the catalog.

The model's operation count is exactly the finite pass length; it does not count callback execution. For a final Module with `n` declarations and `d` deferred rules, straightforward materialization makes `n × d` predicate calls plus one recipe transformation per match. Snapshot expansion has output size equal to the sum of its callback output lengths. Neither statement bounds the work inside callbacks, generated output growth, provider search or tsc. The review workloads target interface catalogs of 5,000 and eventually 100,000 entries; these are workload parameters, not measured capacity or a count of Module declarations. Profile those costs separately before choosing indexes, sharing or incremental execution.

### Model proof scope

The Lean 4 draft is model-only. Definitions and the external TypeScript assumption are separate from [Laws.lean](../formal/module-model/ModuleModel/Laws.lean), whose theorem bodies deliberately use `sorry`. The TypeScript checker contract and admission statements are in PRFC-0001. A successful build of the draft checks definitions and theorem statements, not those proofs or the TypeScript implementation.

`Evaluates` gives relational execution independently of the `collect` interpreter. The proposed laws state finite evaluation for every finite Module and Pass, uniqueness of its result and operation count, agreement with `collect`, and associative composition. There is no fuel limit or maximum input size. Callbacks must be pure, total functions; the theorem does not prove termination of arbitrary TypeScript rewrites, selectors or wrappers. Collection operators visit snapshots, while pass evaluation decreases the remaining finite sequence. Growth of a Module does not need to decrease the Module's size.

Other statements cover pure pointwise filter fusion; fixed-name removal algebra; replacement and namespace locality; N-to-N−1 slot deletion; exact expansion size; final selection and rule order; coverage of later edits; absence of removed targets; and preservation of declared contracts by decoration. Decoration preserves `Valid` because it changes only opaque code, not because wrapper behavior is proved safe. Arbitrary edits need not preserve `Valid`, and arbitrary edits do not commute. Equal Module values need not imply equal diagnostic histories, which are absent from the model.

Plugin installation, removal and strictly shrinking retries are specified in PRFC-0003. Provenance validity, exceptions, park/load, retention and recovery require additional modeling. If implementation verification becomes necessary, first relate the authoring adapter and callbacks to the core, then use an executable verified core or a verified checker of the requested transformation. A well-typed output alone does not establish that the requested deletion or replacement occurred.

## Drawbacks

Frozen snapshots and provenance have a cost. Deferred rules add a final selection pass. Arbitrary callbacks preserve MVP flexibility but weaken guarantees. The existing class adapter still constructs instances during assembly, and boot still repeats wiring resolution; those limits are explicit in PRFC-0001.

## Rationale and alternatives

RxJS-style function composition keeps operator authoring short. A large query-language AST and an optimizer are premature. An unrestricted fixed-point rewrite scheduler makes instrumentation coverage and termination depend on convergence; final-target decoration avoids that requirement. Removing only plugin-owned output cannot undo cross-plugin rewrites, so uninstall always recomputes.

## Prior art

Pipeable operators follow RxJS's composition style. Persistent data structures motivate reusable snapshots and copying changed paths. Compiler source maps motivate the diagnostic side table, with additional operator and deletion origins.

## Unresolved questions

- Promotion of raw TypeScript callbacks into a restricted, provable operator vocabulary.
- Precise field-level and negative-predicate lineage beyond the MVP's operation-level records.
- Reusable class recipes, frozen wiring witnesses and tsc compiler-context reuse.
- Code artifact retention and removed-state policy before changing installed data behavior.

## Future possibilities

Profile representative interface catalogs before introducing incremental execution or query optimization. Reference-model testing can compare TypeScript execution with the Lean model without claiming an implementation proof. A production checker may later validate transformation evidence; it must check the requested operation, not only final type validity.

## Changes

### v2.1.0

- Added: the finite edit/decorate semantics, total callback preconditions, snapshot traversal and composition across one final materialization.
- Updated: the Lean draft's theorem scope, exact pass-operation count and profiling dimensions; distinguished interface catalog size from module size.
- Clarified: ordinary TypeScript callbacks remain available; provenance, runtime effects and adapter refinement are outside the model, and all theorem proofs use `sorry`.

### v2.0.0

- Updated: renumbered the unmerged module-pass draft from PRFC-0021 to PRFC-0025; PRFC-0021 is assigned to Distros.
- Updated: immutable pipeable edits, final-target decoration, plugin pass factories, diagnostic provenance, generation replay and model-only proof scope.
- Removed: registration-order ties and instrumentation depending on repeated rewrites.

### v1.0.0

- Added: manifest registration, the module-tree compile pipeline, boot integration and optional debug output.
