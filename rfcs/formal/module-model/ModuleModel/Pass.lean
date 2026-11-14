import ModuleModel.Operator

/-!
Specification: ../../../PRFC-0025-module-pass.md, "Edits and deferred operators",
"Compilation" and "Composition and termination contracts".

A pass has two operations: transform declarations, or defer a recipe operator.
Sequence is finite. Predicates and transforms are total, pure Lean functions.
A partial or effectful TypeScript callback is not automatically represented by one.

Selection for every deferred rule sees the same final declarations. Wrappers only
change code, so a wrapped result never becomes a new selection target.
-/
namespace ModuleModel

/-- A final selector and the input to `Operator.recipe`; neither owns an instance. -/
abbrev DeferredRule := (Name → Declaration → Bool) × (Code → Code)

inductive Pass where
  | done
  | edit (transform : Module → Module) (next : Pass)
  | defer (rule : DeferredRule) (next : Pass)

namespace Pass

def append : Pass → Pass → Pass
  | .done, right => right
  | .edit f next, right => .edit f (append next right)
  | .defer rule next, right => .defer rule (append next right)

def pipe (passes : List Pass) : Pass := passes.foldr append .done

def editIf (condition : Module → Bool) (transform : Module → Module) : Pass :=
  .edit (fun m => if condition m then transform m else m) .done

def length : Pass → Nat
  | .done => 0
  | .edit _ next => next.length + 1
  | .defer _ next => next.length + 1

/-- Interpret structural edits and collect rules without introducing a new module state type. -/
def collect : Pass → Module → Module × List DeferredRule
  | .done, m => (m, [])
  | .edit f next, m => collect next (f m)
  | .defer rule next, m =>
      let (result, rules) := collect next m
      (result, rule :: rules)

def selected (rules : List DeferredRule) (name : Name) (decl : Declaration) : List DeferredRule :=
  rules.filter (fun rule => rule.1 name decl)

def materialize (rules : List DeferredRule) (m : Module) : Module :=
  m.map (fun (name, decl) =>
    let transformed := (selected rules name decl).foldl
      (fun current rule => Operator.recipe rule.2 current) decl
    (name, transformed))

def run (pass : Pass) (source : Module) : Module :=
  let (result, rules) := collect pass source
  materialize rules result

/-- Cost refinement of structural evaluation, independent of `collect`. -/
inductive EvaluatesIn : Pass → Module → Module → List DeferredRule → Nat → Prop where
  | done (m) : EvaluatesIn .done m m [] 0
  | edit (f) (next) (m result rules steps) :
      EvaluatesIn next (f m) result rules steps →
      EvaluatesIn (.edit f next) m result rules (steps + 1)
  | defer (rule) (next) (m result rules steps) :
      EvaluatesIn next m result rules steps →
      EvaluatesIn (.defer rule next) m result (rule :: rules) (steps + 1)

/-- Structural evaluation observes the result and deferred rules, without counting operations. -/
def Evaluates (pass : Pass) (source result : Module) (rules : List DeferredRule) : Prop :=
  ∃ steps, EvaluatesIn pass source result rules steps

end Pass
end ModuleModel
