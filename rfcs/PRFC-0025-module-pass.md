# PRFC-0025 Module Pass: immutable operators before boot

[中文版](PRFC-0025-module-pass.zh.md)

- Feature Name: `module_compile`
- Start Date: 2026-10-25
- Rev: v2.0.0

## Summary

A pass composes immutable operators over the assembled module tree. Structural edits run once in declared order; decoration rules select their targets from the final structure. Final verification precedes boot. Registration belongs to manifest data; plugin factories supply pass code. See [Module](PRFC-0001-module.md) for the Blueprint/BootPlan/Runtime distinction and [Plugin](PRFC-0003-plugin.md) for generation changes.

## Motivation

Instrumentation must cover nodes produced by later passes without running rewrites to convergence. The same surface must support mocks and deleting a contribution from a slot. Authoring should look like a small `pipe` expression; authors should not implement tree traversal or serialize a SQL AST. Begin with ordinary TypeScript operators and predicates, then restrict the supported core where experience justifies it.

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

`at` lifts a collection operator over the contributions to one slot. Removing a contribution leaves its owner component available for other uses. The MVP preserves contributor order and permits reordering within one owner; an edit that reorders owners is rejected. New entries must name an existing contributor. `replace` preserves module identity; final verification decides whether its new dependencies and provisions fit. `when`, `and`, `or` and `not` express conditions. Ordinary conditions read the input at that step; they are not retroactively re-evaluated.

`decorate` records a rule. The compiler selects concrete provision aliases only after all structural edits, excludes aliases forwarded through exports, and materializes one wrapper per matching rule and provider value at boot. Wrapper-created values never become new compile targets. Telemetry demonstrates typed method wrapping, including providers added after its pass, without recursive walks in the plugin.

A module registers its pass as data:

```json
{ "contributes": { "CompileModule.passes": [{ "id": "telemetry" }] } }
```

Its plugin exports the factory in `passes.telemetry`. Factories are resolved anew per compile attempt. All factories and registrations participating in a retry come from the retained plugin selection.

## Reference-level explanation

### Execution

1. Snapshot the assembled source tree, including nested manifest data. Opaque code references are retained; compiler edits never execute module factories. The snapshot protects earlier inputs and source declarations from mutation.
2. Collect registrations once. Duplicate ids are errors. Topologically order `after` dependencies with lexical id order for ties; a missing dependency means “after it, if present”. Cycles are named errors. Pass-created registrations do not schedule work in this compile.
3. Execute each pass once. Built-in operators copy changed paths and preserve the original child traversal snapshot. `add`, `remove`, `replace` edit structure; `at` edits a slot collection. A failure during rewriting discards both edits and deferred rules. Arbitrary TypeScript rewrites remain an escape hatch and carry no general termination guarantee.
4. Resolve decoration rules against the final tree. Match fully qualified interface keys, with typed handles for wrapper authoring; do not rely on `Function.name`. Exports forward the decorated child value instead of wrapping it again. Rules compose in pass/operator order, later wrappers outside earlier wrappers.
5. Verify the final tree and retain diagnostic origins. Intermediate semantic mismatches are permitted. Graph validation and TypeScript assignment checks are distinct; TypeScript compatibility uses the declaration renderer described by PRFC-0001.
6. Boot the verified candidate. Reassembly and recovery start from original declarations, never from a previously decorated result.

The MVP retains the existing raw `rewrite` escape hatch. Built-in operator provenance includes pass id, operator position/name, affected module/slot, deletion and plugin ownership. Custom callbacks receive conservative pass-level attribution. Source locations and predicate-control lineage can be enriched later; diagnostics must not claim unique causal blame.

### Diagnostics and profiling

Diagnostic provenance is collected independently of debug timing. Final errors report the affected relation plus relevant operators, including removers. A deferred selector or wrapper failure names its operator; the candidate is rejected and best-effort recovery rebuilds without the supplying plugin. A pass modifying another plugin's node is attributed to the supplying pass before falling back to module ownership; best-effort retries exclude the supplying plugin and rebuild from original sources.

`PENGUIN_MODULE_COMPILE_DEBUG=1` collects pass timing and the final tree description. Profiling, rather than a wall-clock theorem, guides optimization. Interface count alone does not bound compilation: record requirement/candidate counts, intermediate sizes, generated declaration size and tsc work separately. Do not enumerate all interface pairs merely because they exist in the catalog.

### Model proof scope

Use Lean 4 initially for the model only. TypeScript types and compatibility in a fixed environment are uninterpreted parameters. Prove termination for every finite input without fuel, using finite input snapshots or well-founded measures; adding nodes need not decrease tree size, but must not reschedule the same traversal on its own output. Arbitrary TS callbacks, tsc execution, imports, migrations and runtime effects are outside that theorem.

Other targets are representation preservation, edit locality, structural deletion idempotence and commutativity for fixed identity sets, pure pointwise filter fusion, deterministic composition, provenance validity and final constraint coverage. State whether an equivalence ignores execution history: two structurally equivalent rewrites can produce different logs. Plugin install/uninstall, admission, retention and recovery proof targets are recorded in PRFC-0003. These are planned proofs, not verified implementation claims.

If implementation verification becomes necessary, reuse the model for an executable verified core or a verified checker of the requested transformation. A well-typed output alone does not establish that the requested deletion or replacement occurred. Actual performance remains a profiling concern.

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

### v2.0.0

- Updated: renumbered the unmerged module-pass draft from PRFC-0021 to PRFC-0025; PRFC-0021 is assigned to Distros.
- Updated: immutable pipeable edits, final-target decoration, plugin pass factories, diagnostic provenance, generation replay and model-only proof scope.
- Removed: registration-order ties and instrumentation depending on repeated rewrites.

### v1.0.0

- Added: manifest registration, the module-tree compile pipeline, boot integration and optional debug output.
