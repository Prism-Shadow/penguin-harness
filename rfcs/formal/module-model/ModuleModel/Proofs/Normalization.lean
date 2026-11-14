import ModuleModel.Basics

/-!
Specification: ../../../../PRFC-0025-module-pass.md, "Edits and deferred operators"
and "Composition and termination contracts". Paper Section 4.1.

The normal form retains both relative orders. It permits changes to their
interleaving, not arbitrary permutation of edits or deferred registrations.
-/
namespace ModuleModel.Pass

theorem collect_normal_form (p : Pass) (m : Module) :
    collect p m = ((edits p).foldl (fun state edit => edit state) m, rules p) := by
  induction p generalizing m with
  | done => rfl
  | edit f p ih => simpa [collect, edits, rules] using ih (f m)
  | defer r p ih => simp [collect, edits, rules, ih]

/-- The semantic result depends only on the two ordered projections. -/
theorem reorder_invariant (p q : Pass)
    (sameEdits : edits p = edits q) (sameRules : rules p = rules q) (m : Module) :
    run p m = run q m := by
  simp only [run, collect_normal_form, sameEdits, sameRules]

theorem defer_across_edit (r : DeferredRule) (f : Module → Module) (p : Pass) (m : Module) :
    run (.defer r (.edit f p)) m = run (.edit f (.defer r p)) m := by
  apply reorder_invariant <;> rfl

/-- Normalization also preserves the observable result and rule sequence of big-step evaluation. -/
theorem reorder_evaluation (p q : Pass)
    (sameEdits : edits p = edits q) (sameRules : rules p = rules q)
    (m result : Module) (deferred : List DeferredRule) :
    Evaluates p m result deferred ↔ Evaluates q m result deferred := by
  have same : collect p m = collect q m := by
    simp only [collect_normal_form, sameEdits, sameRules]
  have characterization (r : Pass) :
      Evaluates r m result deferred ↔ collect r m = (result, deferred) := by
    constructor
    · rintro ⟨n, h⟩
      obtain ⟨hr, hd, _⟩ := evaluates_unique r m _ _ _ _ _ _ (collect_correct r m) h
      exact Prod.ext hr hd
    · intro h
      refine ⟨r.length, ?_⟩
      have c := collect_correct r m
      simpa [h] using c
  rw [characterization p, characterization q, same]

/-- A nontrivial wrapper and a replacement witness why separate finalizations do not compose. -/
theorem separate_finalization_counterexample (q : Name) (d : Declaration) (w : Code → Code)
    (changes : w d.code ≠ d.code) :
    let p := Pass.defer (fun _ _ => true, w) .done
    let r := Pass.edit (Module.replace q d) .done
    run (append p r) [(q, d)] ≠ run r (run p [(q, d)]) := by
  dsimp
  intro equal
  have codeEqual := congrArg (fun m : Module => m.head?.map (fun e => e.2.code)) equal
  simp [run, append, collect, materialize, selected, Module.replace, Operator.recipe] at codeEqual
  exact changes codeEqual

end ModuleModel.Pass
