import ModuleModel.Module

/-!
A pass has two operations: transform declarations, or register a final decoration.
Sequence is finite. Predicates and transforms are total, pure Lean functions.
A partial or effectful TypeScript callback is not automatically represented by one.

Selection for every decoration sees the same final declarations. Wrappers only
change code, so a wrapped result never becomes a new selection target.
-/
namespace ModuleModel

/-- A selector and a recipe transformation; neither owns a runtime instance. -/
abbrev Decoration := (Name → Declaration → Bool) × (Code → Code)

inductive Pass where
  | done
  | edit (transform : Module → Module) (next : Pass)
  | decorate (rule : Decoration) (next : Pass)

namespace Pass

def append : Pass → Pass → Pass
  | .done, right => right
  | .edit f next, right => .edit f (append next right)
  | .decorate rule next, right => .decorate rule (append next right)

def pipe (passes : List Pass) : Pass := passes.foldr append .done

def editIf (condition : Module → Bool) (transform : Module → Module) : Pass :=
  .edit (fun m => if condition m then transform m else m) .done

def length : Pass → Nat
  | .done => 0
  | .edit _ next => next.length + 1
  | .decorate _ next => next.length + 1

/-- Interpret structural edits and collect rules without introducing a new module state type. -/
def collect : Pass → Module → Module × List Decoration
  | .done, m => (m, [])
  | .edit f next, m => collect next (f m)
  | .decorate rule next, m =>
      let (result, rules) := collect next m
      (result, rule :: rules)

def selected (rules : List Decoration) (name : Name) (decl : Declaration) : List Decoration :=
  rules.filter (fun rule => rule.1 name decl)

def materialize (rules : List Decoration) (m : Module) : Module :=
  m.map (fun (name, decl) =>
    let code := (selected rules name decl).foldl (fun code rule => rule.2 code) decl.code
    (name, { decl with code }))

def run (pass : Pass) (source : Module) : Module :=
  let (result, rules) := collect pass source
  materialize rules result

/-- A relational meaning independent of `collect`, with the number of pass operations. -/
inductive Evaluates : Pass → Module → Module → List Decoration → Nat → Prop where
  | done (m) : Evaluates .done m m [] 0
  | edit (f) (next) (m result rules steps) :
      Evaluates next (f m) result rules steps →
      Evaluates (.edit f next) m result rules (steps + 1)
  | decorate (rule) (next) (m result rules steps) :
      Evaluates next m result rules steps →
      Evaluates (.decorate rule next) m result (rule :: rules) (steps + 1)

end Pass
end ModuleModel
