import ModuleModel.Plugin

/-!
Specifications: ../../../PRFC-0001-module.md (declarations and operators),
../../../PRFC-0025-module-pass.md (composition and termination contracts), and
../../../PRFC-0003-plugin.md (reconfiguration guarantees).

Basic properties used by the main proofs and collected in the paper appendix.
The external checker assumption is isolated in External.lean. These theorems
concern the model, not the TypeScript implementation.
-/
namespace ModuleModel

namespace Lists

/-- Deduplication keeps a subsequence; used to relate the executable check to Nodup. -/
theorem dedup_sublist {α : Type} [BEq α] [LawfulBEq α] (xs : List α) :
    xs.eraseDups.Sublist xs := by
  cases xs with
  | nil => simp
  | cons a xs =>
    rw [List.eraseDups_cons]
    exact List.Sublist.cons_cons a ((dedup_sublist _).trans List.filter_sublist)
termination_by xs.length
decreasing_by
  have h := List.length_filter_le (fun b => !b == a) xs
  simp_all
  omega

theorem dedup_nodup {α : Type} [BEq α] [LawfulBEq α] (xs : List α) :
    xs.eraseDups.Nodup := by
  cases xs with
  | nil => simp
  | cons a xs =>
    rw [List.eraseDups_cons, List.nodup_cons]
    exact ⟨by simp, dedup_nodup _⟩
termination_by xs.length
decreasing_by
  have h := List.length_filter_le (fun b => !b == a) xs
  simp_all
  omega

theorem dedup_eq {α : Type} [BEq α] [LawfulBEq α] {xs : List α} (h : xs.Nodup) :
    xs.eraseDups = xs := by
  induction xs with
  | nil => rfl
  | cons a xs ih =>
    obtain ⟨hn, ht⟩ := List.nodup_cons.mp h
    rw [List.eraseDups_cons]
    have hf : xs.filter (fun b => !b == a) = xs := by
      apply List.filter_eq_self.mpr
      intro b hb
      simp only [Bool.not_eq_true', beq_eq_false_iff_ne]
      intro eq
      exact hn (eq ▸ hb)
    rw [hf, ih ht]

theorem nodup_of_dedup_length {α : Type} [BEq α] [LawfulBEq α] {xs : List α}
    (h : xs.eraseDups.length = xs.length) : xs.Nodup := by
  have eq := (dedup_sublist xs).eq_of_length h
  rw [← eq]
  exact dedup_nodup xs

end Lists

namespace Module

@[simp] theorem lookup_cons (q name : Name) (d : Declaration) (m : Module) :
    lookup ((q, d) :: m) name = if q == name then some d else lookup m name := by
  cases h : (q == name) <;> simp [lookup, h]

-- Algebra and locality. Predicates are pure, total functions of the current entry.

theorem filter_fusion (m : Module) (p q : Name → Declaration → Bool) :
    filter q (filter p m) = filter (fun name decl => p name decl && q name decl) m := by
  simp [filter, List.filter_filter, Bool.and_comm]

theorem remove_idempotent (m : Module) (p : Name → Bool) :
    remove p (remove p m) = remove p m := by
  simp [remove, filter, List.filter_filter]

/-- Fixed name predicates commute; predicates inspecting a changing module need not. -/
theorem remove_union (m : Module) (p q : Name → Bool) :
    remove q (remove p m) = remove (fun name => p name || q name) m := by
  simp [remove, filter, List.filter_filter, Bool.and_comm]

theorem remove_commutes (m : Module) (p q : Name → Bool) :
    remove q (remove p m) = remove p (remove q m) := by
  rw [remove_union, remove_union]
  simp [Bool.or_comm]

theorem remove_membership (m : Module) (p : Name → Bool) (name : Name) :
    name ∈ names (remove p m) ↔ name ∈ names m ∧ p name = false := by
  simp [names, remove, filter, List.mem_map, List.mem_filter]

theorem replacement_preserves_names (m : Module) (name : Name) (decl : Declaration) :
    names (replace name decl m) = names m := by
  simp [replace, names, List.map_map]
  intro a b _
  split <;> rfl

theorem replacement_local (m : Module) (name : Name) (decl : Declaration) :
    AgreesOutside (fun other => other == name) m (replace name decl m) := by
  intro other outside
  have ne : other ≠ name := by simpa using outside
  induction m with
  | nil => rfl
  | cons e es ih =>
    rcases e with ⟨q, d⟩
    by_cases hn : q = name <;> by_cases ho : q = other
    all_goals simp_all [replace]

theorem slot_filter_local (m : Module) (scope : Name) (p : Name → Declaration → Bool) :
    AgreesOutside (fun name => name.dropLast == scope) m (filterAt scope p m) := by
  intro other outside
  induction m with
  | nil => rfl
  | cons e es ih =>
    rcases e with ⟨q, d⟩
    simp only [filterAt, filter, List.filter_cons, lookup, List.find?_cons]
    split <;> simp_all [lookup]
    grind

theorem slot_filter_view (m : Module) (scope : Name) (p : Name → Declaration → Bool) :
    members scope (filterAt scope p m) = filter p (members scope m) := by
  simp [members, filterAt, filter, List.filter_filter]
  congr 1
  funext e
  by_cases h : e.1.dropLast = scope <;> simp [h]

/-- Removing one uniquely named slot member takes its cardinality from N to N - 1. -/
theorem remove_one_slot_member (m : Module) (scope target : Name)
    (unique : (names m).Nodup) (present : target ∈ names m)
    (inside : target.dropLast = scope) :
    (members scope (remove (fun name => name == target) m)).length + 1 = (members scope m).length := by
  induction m with
  | nil => simp [names] at present
  | cons e es ih =>
    rcases e with ⟨q, d⟩
    simp only [names, List.map_cons, List.nodup_cons] at unique
    simp only [names, List.map_cons, List.mem_cons] at present
    by_cases eq : q = target
    · subst q
      have absent : target ∉ names es := unique.1
      have unchanged : remove (fun name => name == target) es = es := by
        apply List.filter_eq_self.mpr
        intro e he
        simp only [Bool.not_eq_true', beq_eq_false_iff_ne]
        intro hn
        apply absent
        exact List.mem_map.mpr ⟨e, he, hn⟩
      have head : remove (fun name => name == target) ((target, d) :: es) = es := by
        simpa only [remove, filter, List.filter_cons, beq_self_eq_true, Bool.not_true,
          Bool.false_eq_true, ↓reduceIte] using unchanged
      rw [head]
      simp [members, inside]
    · have presentTail : target ∈ names es := present.resolve_left (Ne.symm eq)
      have step := ih unique.2 presentTail
      simp only [members, remove, filter] at step ⊢
      simp [eq, List.filter_cons]
      split <;> simp_all <;> omega

/-- Output size is exact; the time spent inside an arbitrary callback is not bounded here. -/
theorem expansion_size (m : Module) (f : Name → Declaration → Module) :
    (expand f m).length = (m.map (fun (name, decl) => (f name decl).length)).sum := by
  simp [expand, List.length_flatMap]

-- Validity is independent of the Boolean checker and its order witness.

theorem verify_sound (m : Module) (order : List Name) (accepted : verify m order = true) :
    Valid m := by
  simp only [verify, Bool.and_eq_true, List.all_eq_true, beq_iff_eq] at accepted
  obtain ⟨⟨⟨unique, wellnamed⟩, ordered⟩, deps⟩ := accepted
  refine ⟨Lists.nodup_of_dedup_length (by simpa [names] using unique), ?_, ?_, ?_⟩
  · intro q d hd
    exact wellnamed (q, d) hd
  · intro q d hd target ty ht
    have check := deps (q, d) hd (target, ty) ht
    simp only at check
    refine ⟨check.1, ?_⟩
    cases found : lookup m target with
    | none => simp [found] at check
    | some provider =>
      have answer : typeCheck provider.type ty = some true := by simpa [found] using check.2
      exact ⟨provider, rfl, (typeCheck_correct _ _ true answer).mp rfl⟩
  · refine ⟨fun q => order.idxOf q, ?_⟩
    intro q target ⟨d, ty, hd, ht⟩
    simp only [Module.ordered, Bool.and_eq_true, List.all_eq_true, decide_eq_true_eq] at ordered
    exact ordered.2 (q, d) hd (target, ty) ht

/-- Successful lookup identifies an entry in the input Module. -/
theorem lookup_mem {m : Module} {q : Name} {d : Declaration} (h : lookup m q = some d) :
    (q, d) ∈ m := by
  induction m with
  | nil => simp [lookup] at h
  | cons e es ih =>
    rcases e with ⟨n, e⟩
    by_cases eq : n = q
    · simp [eq] at h
      simp [eq, h]
    · simp [eq] at h
      exact List.mem_cons_of_mem _ (ih h)

/-- An unanswered type question can prevent admission; completeness requires answers. -/
theorem verify_complete (m : Module) (valid : Valid m) (answered : ChecksComplete m) :
    ∃ order, verify m order = true := by
  obtain ⟨hn, hw, hd, rank, hr⟩ := valid
  let order := (names m).mergeSort (fun a b => decide (rank a ≤ rank b))
  have perm : order.Perm (names m) := List.mergeSort_perm _ _
  have sorted : order.Pairwise (fun a b => decide (rank a ≤ rank b) = true) :=
    List.pairwise_mergeSort (by intro a b c; simp only [decide_eq_true_eq]; omega)
      (by intro a b; simp; omega) _
  have depOrder : ∀ q d, (q, d) ∈ m → ∀ target ty, (target, ty) ∈ d.requires →
      order.idxOf target < order.idxOf q := by
    intro q d hq target ty ht
    have rankLt := hr q target ⟨d, ty, hq, ht⟩
    obtain ⟨_, provider, hp, _⟩ := hd q d hq target ty ht
    have qmem : q ∈ order := perm.mem_iff.mpr (List.mem_map.mpr ⟨(q,d), hq, rfl⟩)
    have tmem : target ∈ order := perm.mem_iff.mpr (List.mem_map.mpr ⟨(target,provider), lookup_mem hp, rfl⟩)
    have qi := List.idxOf_lt_length_of_mem qmem
    have ti := List.idxOf_lt_length_of_mem tmem
    apply Classical.byContradiction
    intro bad
    by_cases eq : order.idxOf q = order.idxOf target
    · have same : q = target := by
        calc q = order[order.idxOf q] := (List.getElem_idxOf qi).symm
             _ = order[order.idxOf target] := by simp [eq]
             _ = target := List.getElem_idxOf ti
      simp [same] at rankLt
    · have less : order.idxOf q < order.idxOf target := by omega
      have rel := List.pairwise_iff_getElem.mp sorted _ _ qi ti less
      simp only [List.getElem_idxOf, decide_eq_true_eq] at rel
      omega
  refine ⟨order, ?_⟩
  simp only [verify, Bool.and_eq_true, List.all_eq_true, beq_iff_eq]
  refine ⟨⟨⟨?_, ?_⟩, ?_⟩, ?_⟩
  · rw [Lists.dedup_eq hn]
    simp [names]
  · intro e he
    exact hw e.1 e.2 he
  · simp only [ordered, Bool.and_eq_true, List.all_eq_true, beq_iff_eq, decide_eq_true_eq]
    exact ⟨⟨⟨perm.length_eq, by rw [Lists.dedup_eq (perm.nodup_iff.mpr hn)]⟩,
      fun n h => by simpa using perm.mem_iff.mp h⟩, fun e he r hr => depOrder e.1 e.2 he r.1 r.2 hr⟩
  · intro e he r hreq
    obtain ⟨vis, provider, hp, compat⟩ := hd e.1 e.2 he r.1 r.2 hreq
    obtain ⟨answer, ha⟩ := answered e.1 e.2 he r.1 r.2 hreq provider hp
    have yes := (typeCheck_correct _ _ answer ha).mpr compat
    simp [vis, hp, ha, yes]

theorem accepted_dependency (m : Module) (order : List Name)
    (accepted : verify m order = true)
    (owner : Name) (decl : Declaration) (entry : (owner, decl) ∈ m)
    (target : Name) (required : Ty) (dependency : (target, required) ∈ decl.requires) :
    visible owner target = true ∧
    ∃ provider, lookup m target = some provider ∧ Compatible provider.type required := by
  have h := (verify_sound m order accepted).2.2.1
  exact h owner decl entry target required dependency

theorem valid_has_no_dependency_cycle (m : Module) (valid : Valid m) (name : Name) :
    ¬ Relation.TransGen (Depends m) name name := by
  obtain ⟨rank, hr⟩ := valid.2.2.2
  intro cycle
  have descending : ∀ {a b}, Relation.TransGen (Depends m) a b → rank b < rank a := by
    intro a b h
    induction h with
    | single edge => exact hr _ _ edge
    | tail path edge ih => exact Nat.lt_trans (hr _ _ edge) ih
  exact Nat.lt_irrefl _ (descending cycle)

theorem incomplete_dependency_rejected (m : Module) (order : List Name)
    (owner : Name) (decl : Declaration) (entry : (owner, decl) ∈ m)
    (target : Name) (required : Ty) (dependency : (target, required) ∈ decl.requires)
    (provider : Declaration) (found : lookup m target = some provider)
    (unanswered : typeCheck provider.type required = none) :
    verify m order = false := by
  cases h : verify m order with
  | false => rfl
  | true =>
    simp only [verify, Bool.and_eq_true, List.all_eq_true] at h
    have check := h.2 (owner, decl) entry (target, required) dependency
    simp [found, unanswered] at check

theorem rejection_preserves_current (current candidate : Module) (order : List Name)
    (rejected : verify candidate order = false) :
    admit current candidate order = current := by
  simp [admit, rejected]

theorem admission_preserves_validity (current candidate : Module) (order : List Name)
    (valid : Valid current) : Valid (admit current candidate order) := by
  unfold admit
  split
  · exact verify_sound _ _ (by assumption)
  · exact valid

/-- Mapping recipes or contracts at fixed identities commutes with first lookup. -/
theorem lookup_map (f : Name → Declaration → Declaration) (m : Module) (q : Name) :
    lookup (m.map (fun e => (e.1, f e.1 e.2))) q = (lookup m q).map (f q) := by
  induction m with
  | nil => rfl
  | cons e es ih =>
    rcases e with ⟨n, d⟩
    by_cases h : n = q <;> simp [h, ih]

theorem names_map (f : Name → Declaration → Declaration) (m : Module) :
    names (m.map (fun e => (e.1, f e.1 e.2))) = names m := by
  simp [names, List.map_map]

theorem depends_map (f : Name → Declaration → Declaration)
    (preserve : ∀ n d, (f n d).requires = d.requires) (m : Module) (a b : Name) :
    Depends (m.map (fun e => (e.1, f e.1 e.2))) a b ↔ Depends m a b := by
  simp only [Depends, List.mem_map, Prod.exists]
  constructor
  · rintro ⟨d, ty, ⟨n, old, hm, heq⟩, ht⟩
    cases heq
    exact ⟨old, ty, hm, by simpa [preserve] using ht⟩
  · rintro ⟨d, ty, hm, ht⟩
    exact ⟨f a d, ty, ⟨a, d, hm, rfl⟩, by simpa [preserve] using ht⟩

/-- Contract checks depend on names, provided types and requirements, not recipe code. -/
theorem valid_map (f : Name → Declaration → Declaration)
    (preserve : ∀ n d, (f n d).type = d.type ∧ (f n d).requires = d.requires)
    (m : Module) : Valid (m.map (fun e => (e.1, f e.1 e.2))) ↔ Valid m := by
  have req := fun n d => (preserve n d).2
  have mem : ∀ n d, (n, d) ∈ m → (n, f n d) ∈ m.map (fun e => (e.1, f e.1 e.2)) := by
    intro n d h
    exact List.mem_map.mpr ⟨(n,d), h, rfl⟩
  constructor
  · rintro ⟨unique, named, deps, rank, hr⟩
    refine ⟨by simpa [names_map] using unique, ?_, ?_, rank, ?_⟩
    · intro n d h
      exact named n (f n d) (mem n d h)
    · intro n d h target ty ht
      have r := deps n (f n d) (mem n d h) target ty (by simpa [req] using ht)
      obtain ⟨hv, pd, hp, hc⟩ := r
      rw [lookup_map] at hp
      cases old : lookup m target with
      | none => simp [old] at hp
      | some p =>
        simp [old] at hp
        subst pd
        exact ⟨hv, p, rfl, by simpa [(preserve target p).1] using hc⟩
    · intro a b h
      exact hr a b ((depends_map f req m a b).mpr h)
  · rintro ⟨unique, named, deps, rank, hr⟩
    refine ⟨by simpa [names_map] using unique, ?_, ?_, rank, ?_⟩
    · intro n d h
      obtain ⟨⟨a,b⟩, hm, heq⟩ := List.mem_map.mp h
      have ha : a = n := congrArg Prod.fst heq
      subst n
      exact named a b hm
    · intro n d h target ty ht
      obtain ⟨⟨a,b⟩, hm, heq⟩ := List.mem_map.mp h
      have ha : a = n := congrArg Prod.fst heq
      have hb : f a b = d := congrArg Prod.snd heq
      subst n
      subst d
      obtain ⟨hv, p, hp, hc⟩ := deps a b hm target ty (by simpa [req] using ht)
      exact ⟨hv, f target p, by simp [lookup_map, hp], by simpa [(preserve target p).1] using hc⟩
    · intro a b h
      exact hr a b ((depends_map f req m a b).mp h)

end Module

namespace Operator

-- PRFC-0001: logical composition and application at a fixed declaration identity.

theorem andThen_associative (a b c : Operator) :
    andThen (andThen a b) c = andThen a (andThen b c) := by
  rfl

theorem identity_left (operator : Operator) : andThen identity operator = operator := by
  rfl

theorem identity_right (operator : Operator) : andThen operator identity = operator := by
  rfl

theorem on_composition (a b : Operator) (name : Name) (m : Module) :
    on name (andThen a b) m = on name b (on name a m) := by
  simp [on, andThen, List.map_map]
  intro a b _
  split <;> simp_all

theorem on_preserves_names (operator : Operator) (name : Name) (m : Module) :
    Module.names (on name operator m) = Module.names m := by
  simp [on, Module.names, List.map_map]
  intro a b _
  split <;> rfl

theorem on_local (operator : Operator) (name : Name) (m : Module) :
    Module.AgreesOutside (fun other => other == name) m (on name operator m) := by
  intro other outside
  have ne : other ≠ name := by simpa using outside
  induction m with
  | nil => rfl
  | cons e es ih =>
    rcases e with ⟨q, d⟩
    by_cases hn : q = name <;> by_cases ho : q = other
    all_goals simp_all [on]

theorem recipe_preserves_contracts (wrap : Code → Code) : PreservesContracts (recipe wrap) := by
  intro d
  exact ⟨rfl, rfl⟩

theorem composition_preserves_contracts (a b : Operator)
    (left : PreservesContracts a) (right : PreservesContracts b) :
    PreservesContracts (andThen a b) := by
  intro d
  exact ⟨(right (a d)).1.trans (left d).1, (right (a d)).2.trans (left d).2⟩

theorem on_preserves_validity (operator : Operator) (name : Name) (m : Module)
    (contracts : PreservesContracts operator) :
    Module.Valid (on name operator m) ↔ Module.Valid m := by
  have eq : on name operator m = m.map (fun (n,d) => (n, if n == name then operator d else d)) := by
    unfold on
    apply List.map_congr_left
    intro ⟨n,d⟩ _
    dsimp
    split <;> simp_all
  rw [eq]
  apply Module.valid_map (fun n d => if n == name then operator d else d)
  intro n d
  split
  · exact contracts d
  · exact ⟨rfl, rfl⟩

end Operator

namespace Pass

-- Finite interpretation, with no bound on module size and no fuel parameter.

theorem evaluates_terminates (pass : Pass) (m : Module) :
    ∃ result rules steps, EvaluatesIn pass m result rules steps := by
  induction pass generalizing m with
  | done => exact ⟨m, [], 0, .done m⟩
  | edit f p ih =>
    obtain ⟨result, rules, steps, h⟩ := ih (f m)
    exact ⟨result, rules, steps + 1, .edit f p m result rules steps h⟩
  | defer rule p ih =>
    obtain ⟨result, rules, steps, h⟩ := ih m
    exact ⟨result, rule :: rules, steps + 1, .defer rule p m result rules steps h⟩

theorem evaluates_unique (pass : Pass) (m a b : Module)
    (ra rb : List DeferredRule) (na nb : Nat)
    (left : EvaluatesIn pass m a ra na) (right : EvaluatesIn pass m b rb nb) :
    a = b ∧ ra = rb ∧ na = nb := by
  induction left generalizing b rb nb with
  | done m => cases right; exact ⟨rfl, rfl, rfl⟩
  | edit f p m result rules steps h ih =>
    cases right with
    | edit _ _ _ _ _ _ h2 =>
      obtain ⟨rfl, rfl, rfl⟩ := ih _ _ _ h2
      exact ⟨rfl, rfl, rfl⟩
  | defer rule p m result rules steps h ih =>
    cases right with
    | defer _ _ _ _ _ _ h2 =>
      obtain ⟨rfl, rfl, rfl⟩ := ih _ _ _ h2
      exact ⟨rfl, rfl, rfl⟩

/-- Counts pass operations; callbacks and the type checker have separate costs. -/
theorem evaluates_steps (pass : Pass) (m result : Module) (rules : List DeferredRule) (steps : Nat)
    (evaluation : EvaluatesIn pass m result rules steps) : steps = pass.length := by
  induction evaluation <;> simp_all [length]

theorem collect_correct (pass : Pass) (m : Module) :
    EvaluatesIn pass m (collect pass m).1 (collect pass m).2 pass.length := by
  induction pass generalizing m with
  | done => exact .done m
  | edit f p ih => exact .edit _ _ _ _ _ _ (ih (f m))
  | defer rule p ih => exact .defer _ _ _ _ _ _ (ih m)

theorem append_associative (a b c : Pass) :
    append (append a b) c = append a (append b c) := by
  induction a <;> simp_all [append]

/-- Collect across the whole composition before applying any deferred rule. -/
theorem collect_append (a b : Pass) (m : Module) :
    collect (append a b) m =
      let first := collect a m
      let second := collect b first.1
      (second.1, first.2 ++ second.2) := by
  induction a generalizing m <;> simp_all [append, collect]

-- Final recipe operators. No behavioral law about code is assumed.

theorem selected_exactly (rules : List DeferredRule) (rule : DeferredRule)
    (name : Name) (decl : Declaration) :
    rule ∈ selected rules name decl ↔ rule ∈ rules ∧ rule.1 name decl = true := by
  simp [selected]

theorem selection_preserves_order (rules : List DeferredRule) (name : Name) (decl : Declaration) :
    (selected rules name decl).Sublist rules := by
  exact List.filter_sublist

theorem fold_recipe (rules : List DeferredRule) (d : Declaration) :
    rules.foldl (fun current rule => Operator.recipe rule.2 current) d =
      { d with code := rules.foldl (fun code rule => rule.2 code) d.code } := by
  induction rules generalizing d with
  | nil => rfl
  | cons r rs ih =>
    simp only [List.foldl_cons]
    rw [ih]
    rfl

theorem materialize_names (rules : List DeferredRule) (m : Module) :
    Module.names (materialize rules m) = Module.names m := by
  exact Module.names_map (fun n d => (selected rules n d).foldl
    (fun current rule => Operator.recipe rule.2 current) d) m

theorem materialize_preserves_contracts (rules : List DeferredRule) (m : Module) :
    (materialize rules m).map (fun (name, decl) => (name, decl.type, decl.requires)) =
      m.map (fun (name, decl) => (name, decl.type, decl.requires)) := by
  simp [materialize, fold_recipe, List.map_map]

theorem materialize_preserves_validity (rules : List DeferredRule) (m : Module) :
    Module.Valid (materialize rules m) ↔ Module.Valid m := by
  apply Module.valid_map (fun n d => (selected rules n d).foldl
    (fun current rule => Operator.recipe rule.2 current) d)
  intro n d
  simp [fold_recipe]

/-- Each matching list occurrence wraps once, in order, selected from the final declaration. -/
theorem final_recipe_operators (pass : Pass) (m result : Module) (rules : List DeferredRule)
    (collected : collect pass m = (result, rules))
    (name : Name) (decl : Declaration) (found : Module.lookup result name = some decl) :
    Module.lookup (run pass m) name =
      some { decl with code := (selected rules name decl).foldl (fun code rule => rule.2 code) decl.code } := by
  simp only [run, collected]
  change Module.lookup (result.map (fun e => (e.1, (selected rules e.1 e.2).foldl
    (fun current rule => Operator.recipe rule.2 current) e.2))) name = _
  rw [Module.lookup_map (fun n d => (selected rules n d).foldl
    (fun current rule => Operator.recipe rule.2 current) d) result name, found]
  simp only [Option.map_some, fold_recipe]

theorem deferred_operators_cover_later_edits (rule : DeferredRule) (f : Module → Module) (m : Module) :
    run (.defer rule (.edit f .done)) m = materialize [rule] (f m) := by
  rfl

theorem removed_targets_stay_absent (pass : Pass) (m : Module) (name : Name)
    (absent : name ∉ Module.names (collect pass m).1) :
    name ∉ Module.names (run pass m) := by
  simpa only [run, materialize_names] using absent

end Pass

namespace Plugin

-- Membership selects plugins; a fixed catalog fixes precedence; every build starts at base.

theorem selection_unique (catalog : List Plugin) (enabled : List Name)
    (unique : catalogValid catalog) :
    ((selected catalog enabled).map Plugin.name).Nodup := by
  have sub : List.Sublist ((selected catalog enabled).map Plugin.name) (catalog.map Plugin.name) :=
    List.Sublist.map _ List.filter_sublist
  exact unique.sublist sub

theorem selected_is_enabled (catalog : List Plugin) (enabled : List Name) (plugin : Plugin)
    (present : plugin ∈ selected catalog enabled) : plugin.name ∈ enabled := by
  have h := (List.mem_filter.mp present).2
  simpa using h

theorem build_depends_on_selection (base : Module) (catalog : List Plugin) (a b : List Name)
    (same : ∀ name, name ∈ a ↔ name ∈ b) : build base catalog a = build base catalog b := by
  have eq : selected catalog a = selected catalog b := by
    unfold selected
    congr 1
    funext p
    exact Bool.eq_iff_iff.mpr (by simpa using same p.name)
  simp only [build, program, source, eq]

/-- Uninstalling a plugin that was already enabled would not restore the initial selection. -/
theorem install_then_uninstall (base : Module) (catalog : List Plugin)
    (enabled : List Name) (name : Name) (fresh : name ∉ enabled) :
    build base catalog (uninstall name (install name enabled)) = build base catalog enabled := by
  apply build_depends_on_selection
  intro q
  simp [install, uninstall, fresh]
  grind

theorem install_idempotent (base : Module) (catalog : List Plugin)
    (enabled : List Name) (name : Name) :
    build base catalog (install name (install name enabled)) =
      build base catalog (install name enabled) := by
  apply build_depends_on_selection
  intro q
  simp [install]
  split <;> simp_all

theorem uninstall_idempotent (base : Module) (catalog : List Plugin)
    (enabled : List Name) (name : Name) :
    build base catalog (uninstall name (uninstall name enabled)) =
      build base catalog (uninstall name enabled) := by
  apply build_depends_on_selection
  intro q
  simp [uninstall]

/-- Absence from scheduling makes no claim about old running code. -/
theorem uninstalled_not_selected (catalog : List Plugin) (enabled : List Name) (plugin : Plugin) :
    plugin ∉ selected catalog (uninstall plugin.name enabled) := by
  simp [selected, uninstall]

theorem remaining_request_retains_plugin (catalog : List Plugin) (plugin : Plugin)
    (known : plugin ∈ catalog) (requests : List (List Name)) (request : List Name)
    (remaining : request ∈ requests) (wanted : plugin.name ∈ request) :
    plugin ∈ selected catalog (effective requests) := by
  apply List.mem_filter.mpr
  exact ⟨known, by simpa [effective] using List.mem_flatten.mpr ⟨request, remaining, wanted⟩⟩

theorem retirement_decreases {next current : List Name} (h : Retires next current) :
    next.eraseDups.length < current.eraseDups.length := by
  obtain ⟨sub, q, hq, absent⟩ := h
  have nodup : (q :: next.eraseDups).Nodup := by
    simp only [List.nodup_cons, List.mem_eraseDups]
    exact ⟨absent, Lists.dedup_nodup next⟩
  have subset : q :: next.eraseDups ⊆ current.eraseDups := by
    intro n hn
    simp only [List.mem_cons, List.mem_eraseDups] at hn ⊢
    rcases hn with rfl | hn
    · exact hq
    · exact sub n hn
  have bound := nodup.length_le_of_subset subset
  simp only [List.length_cons] at bound
  omega

/-- Any policy satisfying strict retirement terminates; maximal retained sets are not promised. -/
theorem retry_wellFounded : WellFounded Retires := by
  exact Subrelation.wf (fun h => retirement_decreases h)
    (measure (fun (s : List Name) => s.eraseDups.length)).wf

theorem retry_bound (initial : List Name) (rest : List (List Name))
    (progress : ∀ before after, (before, after) ∈ (initial :: rest).zip rest →
      Retires after before) :
    rest.length ≤ initial.eraseDups.length := by
  induction rest generalizing initial with
  | nil => simp
  | cons next rest ih =>
    have step := progress initial next (by simp)
    have tail : ∀ before after, (before, after) ∈ (next :: rest).zip rest → Retires after before := by
      intro before after h
      exact progress before after (by simp only [List.zip_cons_cons, List.mem_cons]; exact Or.inr h)
    have bound := ih next tail
    have decreases := retirement_decreases step
    simp only [List.length_cons]
    omega

end Plugin
end ModuleModel
