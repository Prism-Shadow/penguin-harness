import Std

/-!
Specification: ../../../PRFC-0001-module.md, "The judgment rules" and
"Compilation, verification and runtime assembly".

The external boundary, for one fixed TypeScript environment and code revision.

These symbols describe types and opaque recipes, not the TypeScript type system or
JavaScript execution. No law of subtyping, recipe equivalence, purity, or runtime
behavior is assumed. A completed oracle answer agrees with compatibility; `none`
means that no answer was obtained. No oracle completeness or termination is assumed.
-/
namespace ModuleModel

axiom Ty : Type
axiom Code : Type
axiom Compatible : Ty → Ty → Prop
axiom typeCheck : Ty → Ty → Option Bool

/-- The only external propositional axiom. It concerns completed checks only. -/
axiom typeCheck_correct (offered required : Ty) (answer : Bool) :
    typeCheck offered required = some answer →
      (answer = true ↔ Compatible offered required)

end ModuleModel
