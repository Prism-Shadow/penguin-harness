import ModuleModel.Plugin

/-!
Specification: ../../../PRFC-0003-plugin.md, "Compile passes and generation changes";
../../../PRFC-0025-module-pass.md, "Compilation" and "Diagnostics and profiling".

An explicit compilation machine accumulates edits and registrations. Restart creates
fresh scratch state from the retained source selection. Attempts may fail at any
prefix; no failed scratch state is an input to the next attempt. Code import, factory
freshness, exceptions and diagnostics require a TypeScript correspondence argument.
-/
namespace ModuleModel.Replay

structure Machine where
  current : Module
  pending : Pass
  deferred : List DeferredRule

def start (base : Module) (catalog : List Plugin) (enabled : List Name) : Machine :=
  ⟨Plugin.source base catalog enabled, Plugin.program catalog enabled, []⟩

inductive Step : Machine → Machine → Prop where
  | edit (m : Module) (p : Pass) (ds : List DeferredRule) (f : Module → Module) :
      Step ⟨m, .edit f p, ds⟩ ⟨f m, p, ds⟩
  | defer (m : Module) (p : Pass) (ds : List DeferredRule) (r : DeferredRule) :
      Step ⟨m, .defer r p, ds⟩ ⟨m, p, ds ++ [r]⟩

inductive Steps : Machine → Machine → Prop where
  | refl (s : Machine) : Steps s s
  | cons {a b c : Machine} : Step a b → Steps b c → Steps a c

def finish (current : Module) (deferred : List DeferredRule) : Module :=
  Pass.materialize deferred current

/-- Every attempt starts fresh; intermediate failed attempts are retained only as history. -/
inductive Attempts (base : Module) (catalog : List Plugin) : List (List Name) → Module → Prop where
  | accept (enabled : List Name) (m : Module) (ds : List DeferredRule) :
      Steps (start base catalog enabled) ⟨m, .done, ds⟩ →
      Attempts base catalog [enabled] (finish m ds)
  | retry (before next : List Name) (tail : List (List Name)) (scratch : Machine) (result : Module) :
      Steps (start base catalog before) scratch →
      Plugin.Retires next before →
      Attempts base catalog (next :: tail) result →
      Attempts base catalog (before :: next :: tail) result

end ModuleModel.Replay
