import ModuleModel.Module

/-!
Specification: ../../../PRFC-0001-module.md, "Declarations and operators";
../../../PRFC-0025-module-pass.md, "Edits and deferred operators".

An Operator transforms a declaration. Identity and position live in the containing
Module. This domain operation is independent of the language used to express it.
Class and field annotations must elaborate to the corresponding declarations and
operator applications; this file does not formalize a TypeScript parser or its evaluation rules.

Ordinary operators may change contracts. Deferred pass rules use `recipe`,
which is the same operation restricted to opaque code. Only that restriction
preserves declared contracts without an additional premise.
-/
namespace ModuleModel

abbrev Operator := Declaration → Declaration

namespace Operator

def identity : Operator := id

/-- Logical composition order: apply the left operator, then the right. -/
def andThen (left right : Operator) : Operator := fun decl => right (left decl)

def withType (type : Ty) : Operator := fun decl => { decl with type }

def require (target : Name) (type : Ty) : Operator :=
  fun decl => { decl with requires := decl.requires ++ [(target, type)] }

def recipe (wrap : Code → Code) : Operator :=
  fun decl => { decl with code := wrap decl.code }

/-- Apply at a fixed identity; duplicate intermediate entries are all transformed. -/
def on (name : Name) (operator : Operator) (m : Module) : Module :=
  m.map (fun entry => if entry.1 == name then (entry.1, operator entry.2) else entry)

def PreservesContracts (operator : Operator) : Prop :=
  ∀ decl, (operator decl).type = decl.type ∧ (operator decl).requires = decl.requires

end Operator
end ModuleModel
