import ModuleModel.Module

/-!
Specification: ../../../PRFC-0001-module.md, "Declarations and decorators";
../../../PRFC-0025-module-pass.md, "Edits and decorators".

A Decorator transforms a declaration. Identity and position live in the containing
Module. This domain operation is independent of the language used to express it.
Class and field annotations must elaborate to the corresponding declarations and
decorators; this file does not formalize a TypeScript parser or its evaluation rules.

Ordinary decorators may change contracts. Deferred pass decoration uses `recipe`,
which is the same operation restricted to opaque code. Only that restriction
preserves declared contracts without an additional premise.
-/
namespace ModuleModel

abbrev Decorator := Declaration → Declaration

namespace Decorator

def identity : Decorator := id

/-- Logical composition order: apply the left decorator, then the right. -/
def andThen (left right : Decorator) : Decorator := fun decl => right (left decl)

def withType (type : Ty) : Decorator := fun decl => { decl with type }

def require (target : Name) (type : Ty) : Decorator :=
  fun decl => { decl with requires := decl.requires ++ [(target, type)] }

def recipe (wrap : Code → Code) : Decorator :=
  fun decl => { decl with code := wrap decl.code }

/-- Apply at a fixed identity; duplicate intermediate entries are all transformed. -/
def on (name : Name) (decorator : Decorator) (m : Module) : Module :=
  m.map (fun entry => if entry.1 == name then (entry.1, decorator entry.2) else entry)

def PreservesContracts (decorator : Decorator) : Prop :=
  ∀ decl, (decorator decl).type = decl.type ∧ (decorator decl).requires = decl.requires

end Decorator
end ModuleModel
