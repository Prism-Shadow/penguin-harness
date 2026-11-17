import ModuleModel.Proofs.Normalization
import ModuleModel.Replay

/-!
Specification: ../../../../PRFC-0003-plugin.md, "Reconfiguration guarantees";
../../../../PRFC-0025-module-pass.md, "Compilation". Paper Section 4.2 (Cordis 2026).

Machine execution refines clean source rebuilding, even after failed partial attempts.
The counterexamples explain why output inversion and a DI-only impact graph cannot
implement general plugin removal. They make no claim about undoing runtime effects.
-/
namespace ModuleModel.Replay

def meaning (s : Machine) : Module :=
  let (m, ds) := Pass.collect s.pending s.current
  Pass.materialize (s.deferred ++ ds) m

theorem step_preserves_meaning {a b : Machine} (step : Step a b) : meaning a = meaning b := by
  cases step <;> simp [meaning, Pass.collect, List.append_assoc]

theorem steps_preserve_meaning {a b : Machine} (steps : Steps a b) : meaning a = meaning b := by
  induction steps with
  | refl => rfl
  | cons h _ ih => exact (step_preserves_meaning h).trans ih

theorem machine_completes (s : Machine) :
    ∃ m ds, Steps s ⟨m, .done, ds⟩ := by
  obtain ⟨m,p,ds⟩ := s
  induction p generalizing m ds with
  | done => exact ⟨m, ds, .refl _⟩
  | edit f p ih =>
    obtain ⟨out, rules, h⟩ := ih (f m) ds
    exact ⟨out, rules, .cons (.edit ..) h⟩
  | defer r p ih =>
    obtain ⟨out, rules, h⟩ := ih m (ds ++ [r])
    exact ⟨out, rules, .cons (.defer ..) h⟩

theorem machine_refines_build (base : Module) (catalog : List Plugin) (enabled : List Name)
    (m : Module) (ds : List DeferredRule)
    (steps : Steps (start base catalog enabled) ⟨m, .done, ds⟩) :
    finish m ds = Plugin.build base catalog enabled := by
  have h := steps_preserve_meaning steps
  simpa [meaning, start, finish, Plugin.build, Pass.run, Pass.collect] using h.symm

/-- Partial edits and deferred rules from discarded attempts cannot contaminate the result. -/
theorem attempts_refine_build {base : Module} {catalog : List Plugin}
    {history : List (List Name)} {result : Module}
    (attempts : Attempts base catalog history result) :
    ∃ enabled, history.getLast? = some enabled ∧ result = Plugin.build base catalog enabled := by
  induction attempts with
  | accept enabled m ds steps =>
    exact ⟨enabled, by simp, machine_refines_build _ _ _ _ _ steps⟩
  | retry before next tail scratch result _ _ _ ih =>
    obtain ⟨enabled, last, eq⟩ := ih
    exact ⟨enabled, by simpa using last, eq⟩

/-- Arbitrary prior failed attempts are unobservable in the accepted declarations. -/
theorem history_independent {base : Module} {catalog : List Plugin}
    {h₁ h₂ : List (List Name)} {r₁ r₂ : Module}
    (a₁ : Attempts base catalog h₁ r₁) (a₂ : Attempts base catalog h₂ r₂)
    (sameLast : h₁.getLast? = h₂.getLast?) : r₁ = r₂ := by
  obtain ⟨s₁, last₁, eq₁⟩ := attempts_refine_build a₁
  obtain ⟨s₂, last₂, eq₂⟩ := attempts_refine_build a₂
  have same : s₁ = s₂ := Option.some.inj (last₁.symm.trans (sameLast.trans last₂))
  simp_all

end ModuleModel.Replay

namespace ModuleModel.Plugin

/-- Non-injective edits cannot be inverted from their output, even when the edit is known. -/
theorem no_output_only_undo (q : Name) (d₁ d₂ : Declaration) (different : d₁ ≠ d₂) :
    ¬ ∃ undo : Module → Module, ∀ m,
      undo (Module.remove (fun n => n == q) m) = m := by
  rintro ⟨undo, restores⟩
  have left := restores [(q,d₁)]
  have right := restores [(q,d₂)]
  simp [Module.remove, Module.filter] at left right
  have same : [(q,d₁)] = [(q,d₂)] := left.symm.trans right
  have : d₁ = d₂ := by simpa using same
  exact different this

/-- A pass can observe an entry without declaring a DI dependency on it. -/
def presenceChoice (observed : Name) (yes no : Module) (m : Module) : Module :=
  if (Module.names m).contains observed then yes else no

/-- Removing a DI-isolated trigger changes another declaration; both candidates can be valid. -/
theorem di_graph_insufficient (x y : Name) (dx d₀ d₁ : Declaration)
    (differentNames : x ≠ y) (differentRecipes : d₀ ≠ d₁)
    (noDependencies₀ : d₀.requires = []) (noDependencies₁ : d₁.requires = [])
    (wellnamed : Module.named y = true) :
    let old := presenceChoice x [(y,d₁)] [(y,d₀)] [(x,dx)]
    let rebuilt := presenceChoice x [(y,d₁)] [(y,d₀)] []
    Module.Valid old ∧ Module.Valid rebuilt ∧
    ¬ Module.Depends old y x ∧ Module.remove (fun q => q == x) old ≠ rebuilt := by
  dsimp [presenceChoice]
  simp only [Module.names, List.map_cons, List.map_nil, List.contains_cons,
    beq_self_eq_true, Bool.true_or, List.contains_nil, Bool.false_eq_true, ↓reduceIte]
  have singletonValid (d : Declaration) (empty : d.requires = []) : Module.Valid [(y,d)] := by
    refine ⟨by simp [Module.names], ?_, ?_, fun _ => 0, ?_⟩
    · intro n e h; simp only [List.mem_singleton, Prod.mk.injEq] at h
      obtain ⟨rfl,rfl⟩ := h; exact wellnamed
    · intro n e h target ty ht
      simp only [List.mem_singleton, Prod.mk.injEq] at h
      obtain ⟨rfl,rfl⟩ := h; simp [empty] at ht
    · intro a b ⟨d,ty,h,ht⟩
      simp only [List.mem_singleton, Prod.mk.injEq] at h
      obtain ⟨rfl,rfl⟩ := h; simp [empty] at ht
  refine ⟨singletonValid _ noDependencies₁, singletonValid _ noDependencies₀, ?_, ?_⟩
  · simp [Module.Depends, noDependencies₁]
  · simp [Module.remove, Module.filter, Ne.symm differentNames, Ne.symm differentRecipes]

end ModuleModel.Plugin
