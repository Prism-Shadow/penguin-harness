import ModuleModel.Basics
import ModuleModel.HMR

/-!
Specifications: ../../../../PRFC-0002-hmr.md, ../../../../PRFC-0003-plugin.md,
../../../../PRFC-0015-agent-state.md. Paper Section 4.3.

Safety is derived for all reachable protocol states from local transition rules.
No rule assumes Safe of the destination. New artifacts must carry their dependencies;
resource retention can add only already reachable references. Collection checks all
root classes. No progress, callback success, observational rollback or TypeScript
implementation refinement is assumed or proved here.
-/
namespace ModuleModel.HMR

theorem reach_bind {graph : Graph} {left right : List Artifact}
    (roots : ∀ a, a ∈ left → Reach graph right a) {a : Artifact}
    (h : Reach graph left a) : Reach graph right a := by
  induction h with
  | root h => exact roots _ h
  | dependency _ edge ih => exact .dependency ih edge

theorem transfer_safe {graph : Graph} {before after : State} (safe : Safe graph before)
    (roots : ∀ a, a ∈ after.roots → Reach graph before.roots a)
    (store : before.stored ⊆ after.stored) : Safe graph after := by
  intro a h
  exact store (safe a (reach_bind roots h))

theorem extend_safe {graph : Graph} {before after : State} {bundle : List Artifact} {next : Generation}
    (safe : Safe graph before) (complete : CompleteBundle graph before.roots bundle next)
    (roots : after.roots ⊆ before.roots ++ next.code)
    (store : after.stored = before.stored ++ bundle) : Safe graph after := by
  intro a h
  have split : Reach graph before.roots a ∨ a ∈ bundle := by
    induction h with
    | root h =>
      rcases List.mem_append.mp (roots h) with old | fresh
      · exact Or.inl (.root old)
      · exact Or.inr (complete.1 _ fresh)
    | dependency _ edge ih =>
      rcases ih with old | fresh
      · exact Or.inl (.dependency old edge)
      · exact (complete.2 _ fresh _ edge).symm
  rw [store]
  rcases split with old | fresh
  · exact List.mem_append_left _ (safe _ old)
  · exact List.mem_append_right _ fresh

theorem current_is_image {phase : Phase} {g : Generation} (h : phase.current = some g) :
    g ∈ phase.images := by
  cases phase <;> simp_all [Phase.current, Phase.images]

theorem step_safe {graph : Graph} {before after : State}
    (step : Step graph before after) (safe : Safe graph before) : Safe graph after := by
  cases step with
  | prepare old next snap ts rs store bundle order checked complete =>
    apply extend_safe safe complete ?_ rfl
    intro a h
    simp_all [State.roots, Phase.roots, Phase.images]
    grind
  | repair old next snap ts rs store bundle order checked complete =>
    apply extend_safe safe complete ?_ rfl
    intro a h
    simp_all [State.roots, Phase.roots, Phase.images]
    grind
  | reclaim s a dead =>
    intro b hb
    have old : Reach graph before.roots b := hb
    have present := safe b old
    have different : b ≠ a := by intro eq; subst b; exact dead old
    simpa [different] using present
  | retainResource phase ts rs refs store held =>
    refine transfer_safe safe ?_ ?_
    rotate_left
    · intro _ h; exact h
    intro a h
    simp only [State.roots, List.mem_append, List.flatten_cons] at h ⊢
    rcases h with (hp | ht) | (hr | hs)
    · exact .root (by simp only [List.mem_append]; exact Or.inl (Or.inl hp))
    · exact .root (by simp only [List.mem_append]; exact Or.inl (Or.inr ht))
    · exact held a hr
    · exact .root (by simp only [List.mem_append]; exact Or.inr hs)
  | startTask phase g ts rs store current =>
    refine transfer_safe safe ?_ ?_
    rotate_left
    · intro _ h; exact h
    intro a h
    apply Reach.root
    have image := current_is_image current
    simp only [State.roots, List.flatMap_cons, List.mem_append] at h ⊢
    rcases h with (hp | (hg | ht)) | hr
    · exact Or.inl (Or.inl hp)
    · exact Or.inl (Or.inl (List.mem_flatMap.mpr ⟨g, image, hg⟩))
    · exact Or.inl (Or.inr ht)
    · exact Or.inr hr
  | reject | detach | commit | bootFailed | recover | recoveryFailed | finishTask | releaseResource =>
    refine transfer_safe safe ?_ ?_
    rotate_left
    · intro _ h; exact h
    intro a h
    apply Reach.root
    simp_all [State.roots, Phase.roots, Phase.images]
    all_goals grind

theorem step_valid_plans {graph : Graph} {before after : State}
    (step : Step graph before after) (valid : ValidPlans before) : ValidPlans after := by
  cases step with
  | prepare old next snap ts rs store bundle order checked complete =>
    intro g h
    simp only [Phase.images, List.mem_cons, List.not_mem_nil, or_false] at h
    rcases h with rfl | rfl
    · exact valid g (by simp [Phase.images])
    · exact Module.verify_sound _ _ checked
  | repair old next snap ts rs store bundle order checked complete =>
    intro g h
    simp only [Phase.images, List.mem_cons, List.not_mem_nil, or_false] at h
    rcases h with rfl | rfl
    · exact valid g (by simp [Phase.images])
    · exact Module.verify_sound _ _ checked
  | reject | detach | commit | bootFailed | recover | recoveryFailed =>
    intro g h
    apply valid g
    simp_all [Phase.images]
    all_goals grind
  | startTask | finishTask | retainResource | releaseResource | reclaim => exact valid

/-- The main HMR invariant includes active, candidate, task, resource and recovery roots. -/
theorem reachable_invariants {graph : Graph} {initial final : State}
    (steps : Steps graph initial final) (safe : Safe graph initial) (valid : ValidPlans initial) :
    Safe graph final ∧ ValidPlans final := by
  induction steps with
  | refl => exact ⟨safe, valid⟩
  | cons step _ ih => exact ih (step_safe step safe) (step_valid_plans step valid)

/-- Publication never makes an unverified plan current. -/
theorem published_valid {s : State} {g : Generation}
    (valid : ValidPlans s) (current : s.phase.current = some g) : Module.Valid g.plan :=
  valid g (current_is_image current)

/-- A task roots its entire transitive dependency closure, even after its generation retires. -/
theorem running_task_retained {graph : Graph} {s : State} {g : Generation} {a : Artifact}
    (safe : Safe graph s) (task : g ∈ s.tasks) (used : Reach graph g.code a) : a ∈ s.stored := by
  apply safe a
  apply reach_bind (right := s.roots) ?_ used
  intro b hb
  exact .root (List.mem_append_left _ (List.mem_append_right _
    (List.mem_flatMap.mpr ⟨g, task, hb⟩)))

/-- Recovery failure keeps the old snapshot and code available; it need not restore service. -/
theorem recovery_retained {graph : Graph} {s : State} {old : Generation} {snap : Snapshot} {a : Artifact}
    (safe : Safe graph s) (recovery : s.phase.recovery = some (old, snap))
    (used : Reach graph old.code a) : a ∈ s.stored := by
  have image : old ∈ s.phase.images := by
    cases hp : s.phase <;> simp_all [Phase.recovery, Phase.images]
  apply safe a
  apply reach_bind (right := s.roots) ?_ used
  intro b hb
  exact .root (List.mem_append_left _ (List.mem_append_left _
    (List.mem_flatMap.mpr ⟨old, image, hb⟩)))

/-- Cleanup holds a registration token; a successor's different token revokes that authority. -/
theorem stale_release_noop (r : Registry) (key old fresh : Nat) (different : fresh ≠ old) :
    release (acquire r key fresh) key old = acquire r key fresh := by
  funext k
  simp [release, acquire, different]

/-- Cleanup remains effective for the current registration. -/
theorem current_release (r : Registry) (key token : Nat) :
    release (acquire r key token) key token key = none := by
  simp [release, acquire]

/-- New framework tasks can be attached only to the generation currently published. -/
theorem start_uses_current (phase : Phase) (g current : Generation)
    (published : phase.current = some current) (allowed : phase.current = some g) : g = current := by
  exact Option.some.inj (allowed.symm.trans published)

end ModuleModel.HMR
