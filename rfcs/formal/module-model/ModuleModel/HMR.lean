import ModuleModel.Module

/-!
Specifications: ../../../PRFC-0003-plugin.md, "Compile passes and generation changes";
../../../PRFC-0002-hmr.md, lifecycle and publication; ../../../PRFC-0015-agent-state.md,
"The handoff", "The current pointer", and "Dependencies after the old tree's dispose".

A protocol model of one serialized Module/Plugin update. Targets are already present;
transport is not modeled. Parked documents and runtime callbacks are abstract. A
snapshot is retained through both boot and recovery failure. Generation code roots,
task roots and resource-disposer roots remain distinct. The graph describes immutable
artifact identities and their transitive dependencies, not JavaScript heap semantics.

Prepare checks declarations and bundle closure; state preflight remains abstract.
Boot failure, recovery failure and success are possible transitions, not assumed
termination or success of callbacks.
The production implementation still needs a refinement proof for this ordering.
-/
namespace ModuleModel.HMR

abbrev Artifact := Nat
abbrev Snapshot := Nat
abbrev Graph := Artifact → List Artifact

structure Generation where
  id : Nat
  plan : Module
  code : List Artifact

inductive Phase where
  | running (g : Generation)
  | prepared (old next : Generation) (snapshot : Snapshot)
  | booting (old next : Generation) (snapshot : Snapshot)
  | recovering (old : Generation) (snapshot : Snapshot)
  | degraded (old : Generation) (snapshot : Snapshot)

def Phase.images : Phase → List Generation
  | .running g => [g]
  | .prepared old next _ | .booting old next _ => [old, next]
  | .recovering old _ | .degraded old _ => [old]

def Phase.current : Phase → Option Generation
  | .running g | .prepared g _ _ => some g
  | _ => none

def Phase.recovery : Phase → Option (Generation × Snapshot)
  | .running _ => none
  | .prepared old _ snap | .booting old _ snap | .recovering old snap | .degraded old snap =>
    some (old, snap)

def Phase.roots (p : Phase) : List Artifact := p.images.flatMap Generation.code

structure State where
  phase : Phase
  tasks : List Generation
  resources : List (List Artifact)
  stored : List Artifact

def State.roots (s : State) : List Artifact :=
  s.phase.roots ++ s.tasks.flatMap Generation.code ++ s.resources.flatten

inductive Reach (graph : Graph) (roots : List Artifact) : Artifact → Prop where
  | root {a : Artifact} : a ∈ roots → Reach graph roots a
  | dependency {a b : Artifact} : Reach graph roots a → b ∈ graph a → Reach graph roots b

def Safe (graph : Graph) (s : State) : Prop :=
  ∀ a, Reach graph s.roots a → a ∈ s.stored

def ValidPlans (s : State) : Prop := ∀ g, g ∈ s.phase.images → Module.Valid g.plan

/-- New artifacts include their direct dependencies; old stored artifacts may also be used. -/
def CompleteBundle (graph : Graph) (oldRoots bundle : List Artifact) (next : Generation) : Prop :=
  (∀ a, a ∈ next.code → a ∈ bundle) ∧
  (∀ a, a ∈ bundle → ∀ b, b ∈ graph a → b ∈ bundle ∨ Reach graph oldRoots b)

/-- A prepared update either preserves the old instance or crosses the explicit disposal boundary. -/
inductive Step (graph : Graph) : State → State → Prop where
  | prepare (old next : Generation) (snap : Snapshot) (tasks : List Generation)
      (resources : List (List Artifact)) (stored bundle : List Artifact) (order : List Name) :
      Module.verify next.plan order = true →
      CompleteBundle graph (State.roots ⟨.running old, tasks, resources, stored⟩)
        bundle next →
      Step graph ⟨.running old, tasks, resources, stored⟩
        ⟨.prepared old next snap, tasks, resources, stored ++ bundle⟩
  | reject (old next : Generation) (snap : Snapshot) (ts : List Generation)
      (rs : List (List Artifact)) (store : List Artifact) :
      Step graph ⟨.prepared old next snap, ts, rs, store⟩ ⟨.running old, ts, rs, store⟩
  | detach (old next : Generation) (snap : Snapshot) (ts : List Generation)
      (rs : List (List Artifact)) (store : List Artifact) :
      Step graph ⟨.prepared old next snap, ts, rs, store⟩ ⟨.booting old next snap, ts, rs, store⟩
  | commit (old next : Generation) (snap : Snapshot) (ts : List Generation)
      (rs : List (List Artifact)) (store : List Artifact) :
      Step graph ⟨.booting old next snap, ts, rs, store⟩ ⟨.running next, ts, rs, store⟩
  | bootFailed (old next : Generation) (snap : Snapshot) (ts : List Generation)
      (rs : List (List Artifact)) (store : List Artifact) :
      Step graph ⟨.booting old next snap, ts, rs, store⟩ ⟨.recovering old snap, ts, rs, store⟩
  | recover (old : Generation) (snap : Snapshot) (ts : List Generation)
      (rs : List (List Artifact)) (store : List Artifact) :
      Step graph ⟨.recovering old snap, ts, rs, store⟩ ⟨.running old, ts, rs, store⟩
  | recoveryFailed (old : Generation) (snap : Snapshot) (ts : List Generation)
      (rs : List (List Artifact)) (store : List Artifact) :
      Step graph ⟨.recovering old snap, ts, rs, store⟩ ⟨.degraded old snap, ts, rs, store⟩
  | repair (old next : Generation) (snap : Snapshot) (ts : List Generation)
      (rs : List (List Artifact)) (store bundle : List Artifact) (order : List Name) :
      Module.verify next.plan order = true →
      CompleteBundle graph (State.roots ⟨.degraded old snap, ts, rs, store⟩) bundle next →
      Step graph ⟨.degraded old snap, ts, rs, store⟩ ⟨.booting old next snap, ts, rs, store ++ bundle⟩
  | startTask (phase : Phase) (g : Generation) (ts : List Generation)
      (rs : List (List Artifact)) (store : List Artifact) :
      phase.current = some g →
      Step graph ⟨phase, ts, rs, store⟩ ⟨phase, g :: ts, rs, store⟩
  | finishTask (phase : Phase) (g : Generation) (before after : List Generation)
      (rs : List (List Artifact)) (store : List Artifact) :
      Step graph ⟨phase, before ++ g :: after, rs, store⟩
        ⟨phase, before ++ after, rs, store⟩
  | retainResource (phase : Phase) (ts : List Generation) (rs : List (List Artifact))
      (refs store : List Artifact) :
      (∀ a, a ∈ refs → Reach graph (State.roots ⟨phase, ts, rs, store⟩) a) →
      Step graph ⟨phase, ts, rs, store⟩ ⟨phase, ts, refs :: rs, store⟩
  | releaseResource (phase : Phase) (ts : List Generation) (before after : List (List Artifact))
      (refs store : List Artifact) :
      Step graph ⟨phase, ts, before ++ refs :: after, store⟩
        ⟨phase, ts, before ++ after, store⟩
  | reclaim (s : State) (a : Artifact) :
      ¬ Reach graph s.roots a →
      Step graph s { s with stored := s.stored.filter (fun b => b != a) }

inductive Steps (graph : Graph) : State → State → Prop where
  | refl (s : State) : Steps graph s s
  | cons {a b c : State} : Step graph a b → Steps graph b c → Steps graph a c

/-- Registration identity, rather than a reusable resource key, authorizes cleanup. -/
abbrev Registry := Nat → Option Nat

def acquire (r : Registry) (key token : Nat) : Registry :=
  fun k => if k = key then some token else r k

def release (r : Registry) (key token : Nat) : Registry :=
  fun k => if k = key ∧ r key = some token then none else r k

end ModuleModel.HMR
