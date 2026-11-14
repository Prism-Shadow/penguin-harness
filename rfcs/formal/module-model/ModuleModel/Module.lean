import ModuleModel.External

/-!
Specification: ../../../PRFC-0001-module.md, "Declarations and operators",
"Visibility is lexical" and "Compilation, verification and runtime assembly".

A module is a finite sequence of named declarations. A qualified name determines
scope; declarations may hold component recipes or ordinary data recipes alike.
There is no second representation for a draft or an accepted module.

Dependencies already name their targets. Resolving a source-language query to these
names, and translating slot syntax to declarations, are outside this first model.
Order is observable: filtering a slot must preserve its remaining members' order.

This resolved-declaration abstraction covers part of the Module mechanism, which
also includes authoring annotations, operators, projection, resolution and runtime assembly.
In particular, the namespace predicate below must be related to the RFC's lexical
visibility rules by elaboration; it does not replace those rules.
-/
namespace ModuleModel

abbrev Name := List String

structure Declaration where
  type : Ty
  requires : List (Name × Ty)
  code : Code

abbrev Module := List (Name × Declaration)

namespace Module

def names (m : Module) : List Name := m.map Prod.fst

def lookup (m : Module) (name : Name) : Option Declaration :=
  (m.find? (fun entry => entry.1 == name)).map Prod.snd

/-- Entries directly in a namespace, in their declared order. A slot can use this view. -/
def members (scope : Name) (m : Module) : Module :=
  m.filter (fun entry => entry.1.dropLast == scope)

/-- Local declarations and declarations in enclosing scopes are visible. -/
def visible (owner target : Name) : Bool := target.dropLast.isPrefixOf owner

def named (name : Name) : Bool := !name.isEmpty && name.all (fun part => !part.isEmpty)

def add (entries : Module) (m : Module) : Module := m ++ entries

/-- The predicate is evaluated only on the input snapshot. -/
def filter (keep : Name → Declaration → Bool) (m : Module) : Module :=
  List.filter (fun entry => keep entry.1 entry.2) m

def remove (selected : Name → Bool) : Module → Module :=
  filter (fun name _ => !selected name)

/-- Changing a declaration keeps its name and its position. -/
def replace (name : Name) (replacement : Declaration) (m : Module) : Module :=
  m.map (fun entry => if entry.1 == name then (entry.1, replacement) else entry)

/-- Results are never revisited. This permits growth without requiring decreasing output size. -/
def expand (f : Name → Declaration → Module) (m : Module) : Module :=
  m.flatMap (fun entry => f entry.1 entry.2)

def filterAt (scope : Name) (keep : Name → Declaration → Bool) : Module → Module :=
  filter (fun name decl => if name.dropLast == scope then keep name decl else true)

/-- Equality outside a named edit region; this says nothing about heap allocation. -/
def AgreesOutside (selected : Name → Bool) (before after : Module) : Prop :=
  ∀ name, selected name = false → lookup before name = lookup after name

/-- An edge goes from a consumer to one of its required providers. -/
def Depends (m : Module) (owner target : Name) : Prop :=
  ∃ decl required, (owner, decl) ∈ m ∧ (target, required) ∈ decl.requires

/-- Semantic validity is separate from the `Module` type; intermediate results need not satisfy it. -/
def Valid (m : Module) : Prop :=
  (names m).Nodup ∧
  (∀ name decl, (name, decl) ∈ m → named name = true) ∧
  (∀ owner decl, (owner, decl) ∈ m →
    ∀ target required, (target, required) ∈ decl.requires →
      visible owner target = true ∧
      ∃ provider, lookup m target = some provider ∧ Compatible provider.type required) ∧
  ∃ rank : Name → Nat, ∀ owner target, Depends m owner target → rank target < rank owner

/-- A proposed order is a witness, not another kind of module. -/
def ordered (m : Module) (order : List Name) : Bool :=
  order.length == (names m).length &&
  order.eraseDups.length == order.length &&
  order.all (fun name => (names m).contains name) &&
  m.all (fun (owner, decl) => decl.requires.all (fun (target, _) =>
    order.idxOf target < order.idxOf owner))

/-- A finite checker relative to the external oracle; `none` cannot admit a dependency. -/
noncomputable def verify (m : Module) (order : List Name) : Bool :=
  (names m).eraseDups.length == m.length &&
  m.all (fun (name, _) => named name) &&
  ordered m order &&
  m.all (fun (owner, decl) => decl.requires.all (fun (target, required) =>
    visible owner target && match lookup m target with
      | none => false
      | some provider => typeCheck provider.type required == some true))

/-- Completeness is conditional on obtaining answers, not on the answers being positive. -/
def ChecksComplete (m : Module) : Prop :=
  ∀ owner decl, (owner, decl) ∈ m →
    ∀ target required, (target, required) ∈ decl.requires →
      ∀ provider, lookup m target = some provider →
        ∃ answer, typeCheck provider.type required = some answer

/-- An admitted replacement is selected only after checking it; no runtime effects are modeled. -/
noncomputable def admit (current candidate : Module) (order : List Name) : Module :=
  if verify candidate order then candidate else current

end Module
end ModuleModel
