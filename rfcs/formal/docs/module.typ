#import "@preview/faithful-acmart:0.2.0": *

// Governing specifications: ../../PRFC-0001-module.md,
// ../../PRFC-0003-plugin.md and ../../PRFC-0025-module-pass.md, revision v2.3.0;
// runtime obligations also refer to PRFC-0002-hmr and PRFC-0015-agent-state.
// Third-party acmart port: https://github.com/fzaiser/faithful-acmart/tree/v0.2.0
// The acmsmall settings follow POPL/PACMPL; this is a design draft.
#show: acmart.with(
  format: "acmsmall",
  font-size: 10pt,
  review: true,
  nonacm: true,
  screen: false,
  print-acm-reference: false,
  authors-addresses: none,
  doi: none,
  isbn: none,
  title: "Operators, Replay, and Hot Reload in a Module Mechanism",
  subtitle: "A Lean-checked model for PenguinHarness",
  short-title: "Module Reconfiguration",
  authors: (),
  abstract: [
    PenguinHarness assembles components from declarations, operators, dependency
    checks, compile passes, and runtime lifecycle rules. Instrumentation must cover
    later replacements; plugin removal must recover declarations lost to destructive
    edits; running Tasks must retain the code they can still call after an update.
    We give a finite declaration model and an abstract hot-reload protocol, with
    proofs checked in Lean. The main results establish a normal form for deferred
    operators, refinement of failed-attempt replay to a clean plugin rebuild, and
    preservation of verified plans and reachable code across handover and recovery.
    Counterexamples delimit permissible reordering, output-only undo, and dependency
    graphs as a basis for incremental recompilation. Cordis 2026 supplies a closely
    related account of runtime effects and hot replacement; our model documents the
    conditions required by this software's declaration transformations and generation
    lifetime rules. External type checking, source elaboration, callback behavior,
    and refinement of the TypeScript implementation remain explicit obligations.
  ],
  keywords: ("module systems", "operators", "plugin reconfiguration", "hot reload", "Lean"),
)

#show raw.where(block: true): set block(breakable: false)
#show table: set par(justify: false)

#let sf(body) = math.upright(math.sans(body))

= Introduction

PenguinHarness assembles an application from interface contracts, component
recipes, scoped declarations, operators, and plugin contributions. Its Module
mechanism also includes signature projection, dependency resolution, verification,
and runtime handover. The governing specifications are the Module, Plugin, and
Module Pass RFCs #cite(<rfc-module>, <rfc-plugin>, <rfc-pass>).

The design problem is how to let independently authored extensions change that
assembly. Instrumentation must reach a mock introduced by a later pass. Removing
one tab must preserve the other contributions and their order. A sequence of edits
may temporarily break a dependency before a later edit repairs it. Uninstalling a
plugin must remove its transformations, even when they deleted or replaced another
plugin's declarations. These cases require an account of composition, observation,
and reconfiguration that authors can use before executing component code.

== Requirements and intended value

We use the following requirements to evaluate the design:

- *R1: express structural changes directly.* An author can replace a recipe or
  remove a named contribution while retaining other declarations. A contribution
  has its own identity; removing it need not remove its owner component.
- *R2: make operator coverage predictable.* A deferred telemetry rule selects the final
  structural declarations, including later replacements. Its application does not
  depend on repeatedly rewriting wrapper-generated output until convergence.
- *R3: validate a composed change.* Authors can pass through temporary contract
  mismatches. Publication depends on the final assembly and on TypeScript's answers
  about its contracts. A rejected candidate leaves the current declaration choice
  available; useful diagnostics must retain the relevant edit origins.
- *R4: explain plugin removal by the selected configuration.* Rebuilding from the
  original declarations and remaining passes determines the next candidate.
  Authors do not have to supply an inverse for every deletion or replacement.
- *R5: retain what a generation can still use.* Handover must preserve the code
  needed by running Tasks, resource cleanup, and recovery, including transitive
  dependencies. A failed recovery must retain a repair path.

The proposed mechanism uses one immutable declaration representation, finite pass
composition, an explicit boundary for deferred operators, and rebuilding from source.
Its intended value is to make the effects of a composed change inspectable: which
entries remain, which recipes are wrapped, which dependencies must check, and
which inputs determine a rebuild. It does not prescribe a query-language-only
API. Pure, total callbacks remain expressible, while the common operations have
names that expose their scope.

This paper provides a checked foundation for those choices. @syntax fixes the
declaration language; @semantics defines evaluation, rebuilding, and the handover
protocol. @guarantees develops deferred operator normalization, plugin replay, and
hot-reload safety. The elementary algebra and its proofs are in @basics.
The purpose is to guide PenguinHarness development. Compiler passes, reversible
effects, and dynamic update already have substantial industrial and academic
precedents; @position identifies the overlap rather than asserting a new paradigm.

== Scope of the claims

Module, Operator, Pass, and Plugin are domain concepts. Names, contracts,
requirements, and recipes are data within them. Source, intermediate, and accepted
snapshots use the same Module representation; validity is a judgment about that
representation. Class and field annotations are one way to express declaration
construction and operator application. Their elaboration must preserve identities,
contracts, scope, and logical operator order.

All accompanying theorem bodies are complete. Lean checks declaration operations
and a protocol over abstract generations, parked snapshots, and immutable code
artifacts. The external TypeScript assumption concerns completed type comparisons.
The protocol does not execute JavaScript or prove state migration correct. It
covers local Module and Plugin replacement; package upload, distribution, and
data-transfer protocols are outside its scope. Relating source syntax, caches,
callbacks, and actual runtime references to this model remains necessary before
its theorems can be claimed for the production implementation.

= Syntax <syntax>

// PRFC-0001: Declarations and operators; PRFC-0025: Edits and deferred operators;
// PRFC-0003: Compile passes and generation changes.
We give one abstract syntax for declarations, operators, edits, passes, and
plugins. The remaining sections use these categories rather than introduce a new
vocabulary for each mechanism. The notation presents the existing domain
operations; it does not require an implementation to allocate a syntax tree for
every operator.

== Atoms and parameters

A name $q$ or scope $s$ is a finite sequence of strings. Contracts $tau in T$ and
code recipes $c in C$ are uninterpreted. $bb(B)$ denotes booleans. The parameters
below are pure, total functions; predicates may inspect the entry given to them,
and $f$ may inspect the whole current Module:

$
  p &: sf("Name") arrow sf("Decl") arrow bb(B), & u &: sf("Name") arrow bb(B), \
  w &: C arrow C, & a &: sf("Decl") arrow sf("Decl"), \
  h &: sf("Name") arrow sf("Decl") arrow sf("Module"), & f &: sf("Module") arrow sf("Module").
$

Multi-letter operation and type names use upright sans-serif; variables and
parameters use mathematical italics. Arrows associate to the right. Parenthesized
argument lists abbreviate successive curried application. A subscript on a named
operation fixes leading parameters, leaving the final declaration or Module argument
unapplied.

Every sequence in @grammar is finite. $[x_1, dots, x_n]$ includes the empty sequence
$[]$; $x :: L$ prepends an element and $L_1 ⧺ L_2$ concatenates sequences.
$epsilon$ is the empty pass. A semicolon inside a declaration separates fields;
in operator and pass expressions it specifies logical execution order.
Comprehensions and sums over sequences count occurrences, including duplicates.

#figure(
  tabular(
    columns: (0.9fr, 3.7fr),
    align: left,
    toprule(),
    [Category], [Abstract syntax],
    midrule(),
    [Requirements], [$R ::= [(q_1 : tau_1), dots, (q_n : tau_n)]$],
    [Declaration], [$d ::= ⟨ tau; R; c ⟩$],
    [Module], [$M ::= [q_1 mapsto d_1, dots, q_n mapsto d_n]$],
    [Operator], [$O ::= sf("id") | sf("type")_tau | sf("need")_(q, tau) | sf("recipe")_w | O;O | a$],
    [Edit], [$E ::= sf("add")_M | sf("filter")_p | sf("remove")_u | sf("replace")_(q, d)$ \
      $quad | sf("expand")_h | sf("filterAt")_(s, p) | sf("at")_(q, O) | f$],
    [Pass], [$P ::= epsilon | E;P | sf("defer")(p, w);P$],
    [Plugin], [$g ::= ⟨ q; M; P ⟩$],
    [Catalog], [$K ::= [g_1, dots, g_n]$],
    [Requests], [$S ::= [q_1, dots, q_n]$],
    bottomrule(),
  ),
  placement: none,
  caption: [The shared syntax. Callbacks are parameters with the domains given
    above. A catalog fixes plugin declarations, pass callbacks, and precedence.],
) <grammar>

== Reading the syntax

A declaration $⟨ tau;R;c ⟩$ offers a contract, requires named contracts,
and carries a recipe. Its name and position belong to the surrounding Module.
An ordinary operator $O$ transforms one declaration. Thus $sf("at")_(q,O)$ preserves
the target's identity while applying an operator. $sf("defer")(p,w)$ records a
selector and the same recipe operator $sf("recipe")_w$ for application after all
structural edits. The latter cannot change a declaration's offered type or
requirements.

$E;P$ executes a structural edit and continues with $P$. We write $P ⊙ Q$ for
concatenation of their instruction sequences and $|P|$ for the number of edit and
deferral instructions. An edit may grow its output; collection operators visit
the input snapshot and do not revisit generated entries. The parameters $a$ and
$f$ retain the general declaration and Module transformations of the model.
Totality is a premise on these parameters, not a syntactic restriction that proves
termination of arbitrary TypeScript code.

For later judgments, $sf("names")(M)$ is the ordered name sequence, $M(q)$ is the
first matching declaration or $⊥$, and $M[s]$ is the ordered subsequence whose
names have parent scope $s$. Names may repeat in intermediate snapshots. Final
validity requires nonempty names with nonempty parts and no duplicates.
$sf("vis")(o,q)$ means that the parent scope of $q$ is a prefix of $o$; dependencies
already name their targets. Relating this resolved-name abstraction to implicit
provider search, exports, aliases, and class scopes is an elaboration obligation.

$sf("support")(S)$ is the set of names occurring in the request sequence. Repeated
requests and request order are representable, but selection uses membership.
$S + q$ installs $q$ if absent, and $S - q$ removes all occurrences of $q$.
Project requests combine by union of their supports. These are operations on
configuration data; they introduce no new kind of Module.

== Application and operation types

Operators and edits apply as $O(d)$ and $E(M)$. Their types are:

$
  sf("Operator") &:= sf("Decl") arrow sf("Decl"), \
  O &: sf("Operator"), \
  E &: sf("Module") arrow sf("Module"), \
  sf("at") &: sf("Name") arrow sf("Operator") arrow sf("Module") arrow sf("Module"), \
  sf("run") &: sf("Pass") arrow sf("Module") arrow sf("Module").
$

The complete call $sf("at")(q,O,M)$ supplies all arguments. Fixing $q$ and $O$
gives the edit

$
  sf("at")_(q,O) &: sf("Module") arrow sf("Module"), \
  sf("at")_(q,O) &:= lambda M . sf("at")(q,O,M).
$

Likewise, $sf("recipe")_w$ is a declaration operator and $sf("filter")_p$ is a
Module edit. The syntax table contains these partially applied operators;
evaluation equations use complete calls. In $sf("at")_(q,O_1;O_2)$, the second
parameter is the single composed operator $O_1;O_2$. Its complete application is
$sf("at")(q,O_1;O_2,M)$. We write $F compose G$ for function composition,
with $(F compose G)(x)=F(G(x))$.

These types specify the input and output representations. They do not require the output
Module to satisfy its dependencies. The separate judgment $⊢ M sf("ok")$ checks
identities, visibility, contract compatibility and acyclicity at admission.
Thus a correctly typed edit can produce an intermediate Module that fails
that judgment; a subsequent edit may repair it. Purity and totality remain
additional premises on callbacks.

#block(breakable: false, above: 0.65em)[
== One example in this syntax

Let $q_s$, $q_d$, and $q_h$ name a store, a debug tab, and a help tab. The two tabs
are direct members of the scope $s_t$; the store is visible to the debug tab.
The help tab has no requirements. Define:

$
  d_s &= ⟨ tau_s; []; c_s ⟩, \
  d_d &= ⟨ tau_d; [(q_s : tau_s)]; c_d ⟩, \
  d_h &= ⟨ tau_h; []; c_h ⟩, \
  d_m &= ⟨ tau_m; []; c_m ⟩, \
  M_0 &= [q_s mapsto d_s, q_d mapsto d_d, q_h mapsto d_h].
$
]

Let $p_s (q,d)$ test $q=q_s$, let $u_d (q)$ test $q=q_d$, and let $w_t$ wrap a recipe
with telemetry. The pass and its providing plugin are:

$
  P_t &= sf("defer")(p_s,w_t); sf("replace")_(q_s,d_m); sf("remove")_(u_d); epsilon, \
  g_t &= ⟨ q_t; []; P_t ⟩.
$

This example fixes the terms used in @semantics. It is deliberately small:
its observations are the remaining names, the store recipe, the dependency checks,
and the result after removing the plugin from the request sequence.

= Semantics and design value <semantics>

We use direct application for operators and edits, big-step evaluation for Passes,
and a separate validity judgment for admission. $O(d)$ applies an operator,
$E(M)$ applies an edit, and $sf("run")(P,M)$ evaluates a complete pass, including its
deferred recipe operators. These operations transform declarations and snapshots;
the recipes they contain remain unexecuted.

== R1: structural edits have an explicit target

// PRFC-0001: Declarations and operators.
For $d=⟨ tau;R;c ⟩$, the application equations are:

$
  sf("id")(d) &= d, \
  sf("type")(tau',d) &= ⟨ tau';R;c ⟩, \
  sf("need")(q,tau',d) &= ⟨ tau;R ⧺ [(q:tau')];c ⟩, \
  sf("recipe")(w,d) &= ⟨ tau;R;w(c) ⟩, \
  (O_1;O_2)(d) &= O_2 (O_1 (d)).
$

$sf("at")(q,O,M)$ applies $O$ to every entry named $q$ and preserves its position;
other entries remain unchanged. $sf("replace")_(q,d)$ instead substitutes $d$ at those
positions. $sf("add")_A$ appends $A$. $sf("filter")_p$ retains matching entries in their
original order, and $sf("remove")_u$ retains those whose names fail $u$.
$sf("filterAt")_(s,p)$ applies the filter only to entries in $M[s]$.
$sf("expand")_h$ concatenates $h(q,d)$ for each input entry. The parameters $a$ and
$f$ use ordinary function application.

In the example, set
$M_1=sf("replace")(q_s,d_m,M_0)$ and
$M_2=sf("remove")(u_d,M_1)$. Then

$
  M_1 &= [q_s mapsto d_m, q_d mapsto d_d, q_h mapsto d_h], \
  M_2 &= [q_s mapsto d_m, q_h mapsto d_h].
$

The observable change is precise: the debug contribution disappears, the help tab
retains its identity and order, and the store remains present with a mock recipe.
The tab view changes from $|M_0[s_t]|=2$ to $|M_2[s_t]|=1$.
A general operator may change contracts; this freedom is needed for structural
rewrites, with validity checked at the boundary described below.

#block(breakable: false, above: 0.65em)[
== R2: a single final boundary determines operator coverage

// PRFC-0025: Edits and deferred operators; Composition and termination contracts.
The big-step judgment $⟨ P,M ⟩ ⇓ (M',Delta)$ returns a structural snapshot and
an ordered list of deferred pairs $(p,w)$. Its rules are:

$
  mat(delim: #none, row-gap: #0.6em,
    display(frac(, ⟨ epsilon,M ⟩ ⇓ (M,[]))), sf("Done");
    display(frac(⟨ P,E(M) ⟩ ⇓ (M',Delta),
      ⟨ E;P,M ⟩ ⇓ (M',Delta))), sf("Edit");
    display(frac(⟨ P,M ⟩ ⇓ (M',Delta),
      ⟨ sf("defer")(p,w);P,M ⟩ ⇓ (M',(p,w)::Delta))), sf("Defer");
  )
$
]

Let $sf("sel")(Delta,q,d)$ retain precisely the pairs whose predicates accept $(q,d)$,
in list order. Finalization $sf("finalize")_Delta$ maps each entry $q mapsto d$ to
$q mapsto (sf("recipe")_(w_1); dots; sf("recipe")_(w_j))(d)$, using the selected pairs.
All selections inspect $M'$ before any wrapper is applied. An empty selection uses
$sf("id")$. We define $sf("run")(P,M)=sf("finalize")(Delta,M')$ from the structural judgment above.

For the running example,

$
  ⟨ P_t,M_0 ⟩ &⇓ (M_2,[(p_s,w_t)]), \
  sf("run")(P_t,M_0) &= [q_s mapsto ⟨ tau_m;[];w_t (c_m) ⟩, q_h mapsto d_h].
$

Telemetry therefore wraps the mock that survives the edits. The removed tab has
no final target. Each matching occurrence in $Delta$ is applied once; registering
a rule twice applies it twice. This gives a fixed place to inspect coverage and
wrapper order without making wrapper output another rewrite target.

Composition must preserve that boundary. For example,
$P_a=sf("defer")(p_s,w_t);epsilon$ and
$P_b=sf("replace")_(q_s,d_m);epsilon$ give the recipe $w_t (c_m)$ in
$sf("run")(P_a ⊙ P_b,M_0)$, whereas $sf("run")(P_b,sf("run")(P_a,M_0))$ gives $c_m$.
The latter is two completed builds. This distinction is observable and is part of
the authoring contract.

== R3: the final candidate determines admission

// PRFC-0001: The judgment rules; Compilation, verification and runtime assembly.
Write $tau_o ≼ tau_r$ for directional contract compatibility in one fixed
TypeScript environment. It is an uninterpreted relation, with no assumed subtype
algebra. The external checker is
$chi:T arrow T arrow {sf("yes"),sf("no"),sf("unknown")}$.

#definition(title: "External assumption", name: "Completed comparisons")[
  For $chi(tau_o,tau_r) != sf("unknown")$,
  $chi(tau_o,tau_r)=sf("yes")$ if and only if $tau_o ≼ tau_r$.
]

The environment fixes compiler options and declaration revisions. The implementation
renders each side's own signature snapshot and asks the corresponding TypeScript
assignment question, preserving direction and transitive references. Missing
signatures, unsupported rendering, and incomplete checks produce no positive
answer. This assumption says nothing about tsc termination or recipe execution.

The judgment $⊢ M sf("ok")$ requires unique, well-formed names and the following
conditions. For every entry $o mapsto ⟨ tau;R;c ⟩$ and every
$(q:tau_r) in R$, $sf("vis")(o,q)$ holds and
$M(q)=⟨ tau_o;R_o;c_o ⟩$ for some $tau_o ≼ tau_r$.
There must also be a rank $rho:sf("Name") arrow bb(N)$ with $rho(q)<rho(o)$ for every
such requirement. The rank rules out dependency cycles.

Let $V(M,pi)$ check the names and dependencies, requiring each comparison to return
$sf("yes")$. The order witness $pi$ lists every name exactly once with providers before
consumers. The admission operation is

$
  sf("admit")(M_c,M_n,pi) = cases(
    M_n & "if" V(M_n,pi)=sf("true"),
    M_c & "otherwise".
  )
$

For the example, suppose $chi(tau_s,tau_s)=sf("yes")$ and
$chi(tau_m,tau_s)=sf("no")$. The debug tab's dependency is satisfied in $M_0$ and
broken in $M_1$. The next edit removes that requirement by deleting its owner;
$M_2$ and its final wrapped result have no remaining requirements. With the
stated well-formed, distinct names, they pass final verification. Thus the composed
edit is admissible even though its intermediate snapshot is not.

If the debug tab remains, verification instead rejects the candidate. The error
should identify its requirement, the mock provider, and the relevant edit origins.
That diagnostic behavior is required by the RFC but is not encoded in this model.
The practical value of the boundary is that operator authors can compose edits;
the cost is a need to retain provenance across the whole composition.

== R4: plugin selection determines a rebuild from source

// PRFC-0003: Compile passes and generation changes; Reconfiguration guarantees.
For a fixed catalog $K$, let $K[S]$ retain plugins whose names occur in
$sf("support")(S)$, preserving catalog order. Write its entries as
$[⟨ q_i;M_i;P_i ⟩]_(i=1)^r$. With base Module $B$, define

$
  sf("source")(B,K,S) &= B ⧺ M_1 ⧺ dots ⧺ M_r, \
  sf("program")(K,S) &= P_1 ⊙ dots ⊙ P_r, \
  sf("build")(B,K,S) &= sf("run")(sf("program")(K,S),sf("source")(B,K,S)).
$

An empty selection contributes no declarations and the empty pass $epsilon$.
Every build starts from the source terms in this equation. For $B=M_0$ and
$K=[g_t]$, enabling $q_t$ gives
$sf("build")(M_0,[g_t],[q_t])=sf("run")(P_t,M_0)$. Removing that request gives

$
  sf("build")(M_0,[g_t],[q_t]-q_t) = sf("build")(M_0,[g_t],[]) = M_0.
$

The original store recipe and debug tab return because the source still contains
them. The removed pass need not reconstruct what it deleted. With several Project
request sequences, a plugin remains selected while its name occurs in any of their
supports. Fixed catalog order determines the order of its transformations.

Rebuilding produces a candidate, so removal of a needed provider may still fail
admission. Restoring declarations also does not restore a live socket or undo an
external write. Runtime handover needs park/load, recovery state, and retained code
artifacts independently of the build equation.

== R5: generations, handover, and recovery <hmr-semantics>

// PRFC-0002: local lifecycle; PRFC-0003: generation changes;
// PRFC-0015: handoff, current pointer, and dependencies after disposal.
A generation $gamma=⟨ i;M;U ⟩$ identifies a compiled plan and its code roots $U$.
Artifact identities include revisions: replacing bytes at the same pathname is
not preservation of the old artifact. A fixed graph $G$ maps each artifact to its
direct code dependencies. Write $sf("reach")_G (U)$ for roots $U$ together with
all dependencies reachable from them. This graph concerns code retention; it is
distinct from the declaration dependency graph used for admission.
The lifecycle and Task obligations follow the HMR and Agent State specifications
#cite(<rfc-hmr>, <rfc-agent-state>).

A protocol state is $H=⟨ phi;J;L;A ⟩$: a phase, running Task generations,
resource-held code roots, and stored artifacts. The phase retains the generations
listed in @phases. A parked snapshot $sigma$ is an opaque document identifier;
its capture, validation, and load behavior are abstract operations.

#figure(
  tabular(
    columns: (2.2fr, 1.15fr, 0.7fr, 1fr),
    align: left,
    toprule(),
    [Phase], [Retained images], [Current], [Recovery],
    midrule(),
    [$sf("running")(gamma)$], [$gamma$], [$gamma$], [None],
    [$sf("prepared")(gamma_o,gamma_n,sigma)$], [$gamma_o,gamma_n$], [$gamma_o$], [$gamma_o,sigma$],
    [$sf("booting")(gamma_o,gamma_n,sigma)$], [$gamma_o,gamma_n$], [None], [$gamma_o,sigma$],
    [$sf("recovering")(gamma_o,sigma)$], [$gamma_o$], [None], [$gamma_o,sigma$],
    [$sf("degraded")(gamma_o,sigma)$], [$gamma_o$], [None], [$gamma_o,sigma$],
    bottomrule(),
  ),
  placement: none,
  caption: [Phases of one serialized update. An image names a plan and code revision,
    not a live instance that can be resurrected after disposal.],
) <phases>

The local Module/Plugin update algorithm is:

+ *Prepare.* With the old generation current, choose the target Module and Plugin
  revisions, rebuild the candidate from its source, and require $V(M_n,pi)$.
  Retain a parked snapshot and the candidate's code bundle. A rejection before
  disposal leaves the old instance current. The abstract model checks the plan
  and bundle; a real implementation must additionally establish that the parked
  state can be loaded and that its capture is synchronized with mutation.
+ *Detach and boot.* Dispose the old tree's generation-owned registrations and
  enter $sf("booting")$. Existing Tasks keep their generation references. There
  is no current generation during this interval, so new framework Tasks wait or
  fail according to host policy. Boot the candidate, load its parked state, and
  publish it only on success. New Tasks then use the new current generation.
+ *Recover or retain a repair path.* If boot fails, release the candidate's owned
  resources and rebuild a fresh old instance from the retained old code and
  snapshot. Recovery success republishes the old generation. Recovery failure
  enters $sf("degraded")$ and retains that code and snapshot; a verified repair
  target can subsequently enter $sf("booting")$. Neither success nor termination
  of a lifecycle callback is assumed.
+ *Retire independently.* A Task releases its generation reference when finished.
  A resource releases its captured code roots after cleanup. An artifact may be
  reclaimed only when it is outside the transitive closure of every remaining
  phase, Task, and resource root.

The candidate bundle $B$ must contain its roots. For each $a in B$, every direct
dependency is either in $B$ or already reachable from the old state's roots.
This local closure condition permits dependencies shared with retained generations.
Resource acquisition may capture already reachable code; fresh code first enters
through a checked bundle. These are transition premises, not an assumption that
the destination state is already safe.

Define the global roots and retention invariant by

$
  sf("roots")(H) &= sf("code")(sf("images")(phi)) ⧺ sf("code")(J) ⧺ sf("flatten")(L), \
  sf("Safe")_G (H) &⇔ sf("reach")_G (sf("roots")(H)) ⊆ A.
$

Here $sf("code")$ concatenates the roots of a generation sequence. The plan
invariant $sf("ValidPlans")(H)$ says that every retained phase image has a valid
Module. Resource keys also carry fresh registration tokens: releasing $(k,t)$
clears key $k$ only if its current token still equals $t$. This prevents a late
old disposer from deleting a successor's registration at the same key.

== Basic properties

Operator composition is associative with an identity. Fixed-predicate filters
fuse; fixed-name deletions commute and are idempotent. Fixed-target edits preserve
other names. Finite Pass evaluation is deterministic, and deferred recipe
operators preserve declared contracts. Verification is sound, and complete when
all required external comparisons return answers. Plugin selection depends on
requested membership; strict retirement bounds the number of retries. These
properties supply the lemmas used below. Their statements, necessary premises,
and proofs are collected in @basics and `Basics.lean`.

= Reconfiguration guarantees <guarantees>

The following results address the boundaries where local edits become a complete
build, a failed attempt becomes a retry, and an old generation becomes retired.
Equality in the first two subsections compares declarations, not live heaps.

== Deferred Operator Normalization <normalization>

Let $sf("edits")(P)$ be the ordered projection of structural instructions and
$sf("rules")(P)$ the ordered projection of deferred pairs. Neither projection
executes a callback. For an edit sequence $[E_1,dots,E_k]$, define
$sf("apply")([E_1,dots,E_k],M)=E_k (dots E_1 (M) dots)$, with the empty sequence
returning $M$.

#theorem(name: "Deferred normal form")[
  For every finite Pass $P$ and Module $M$,
  $
    ⟨ P,M ⟩ ⇓ (sf("apply")(sf("edits")(P),M),sf("rules")(P)).
  $
  This result is unique. Consequently, if
  $sf("edits")(P)=sf("edits")(Q)$ and $sf("rules")(P)=sf("rules")(Q)$, then
  $
    sf("run")(P,M)=sf("run")(Q,M).
  $
]

#proof[
  Induct on $P$. The empty pass contributes neither an edit nor a rule. An edit
  contributes the first function in the edit projection and applies it to the
  input of the induction hypothesis. A deferral leaves that input unchanged and
  prepends its pair to the rule projection. Thus collection returns exactly the
  two projected results. Determinism identifies any derivation with this result;
  finalization is a function of those two results. The Lean proofs are
  `collect_normal_form`, `reorder_evaluation`, and `reorder_invariant` in
  `Proofs/Normalization.lean`.
]

This is a normalization result: every interleaving has the same meaning as the
form containing all structural edits, in order, followed by all deferred rules,
in order. It justifies moving a deferral across a structural edit and implementing
collection with separate edit and rule queues. Selectors inspect the final
structural snapshot, so an earlier registration covers a later replacement.
This depends on a fixed instruction sequence and pure, total callbacks. Moving
source-language code that constructs a callback or chooses which rule to register
requires an additional argument.

The word “reordering” alone would overstate the result. Edits can observe previous
edits; wrapper order can change code; neither sequence is freely permutable. No
claim of general rewrite confluence follows. In particular, normalization does
not permit introducing an extra finalization boundary:

#theorem(name: "Separate finalizations can differ")[
  Let $p(q,d)=sf("true")$, $P=sf("defer")(p,w);epsilon$, and
  $Q=sf("replace")_(q,d);epsilon$, where $d=⟨ tau;R;c ⟩$ and $w(c)!=c$.
  For $M=[q mapsto d]$,
  $
    sf("run")(P ⊙ Q,M) != sf("run")(Q,sf("run")(P,M)).
  $
]

#proof[
  The composed pass replaces the declaration before applying $w$, yielding recipe
  $w(c)$. Separate execution applies $w$ and then replaces the entire declaration,
  yielding $c$. The assumed inequality distinguishes them. This is
  `separate_finalization_counterexample`.
]

== Plugin Reconfiguration (Cordis 2026) <plugin-guarantee>

Rebuilding has an operational obligation beyond the equation defining
$sf("build")$: partial failed attempts must not become the input of a later one.
Use a machine state $X=⟨ M;P;Delta ⟩$, containing current declarations, pending
instructions, and accumulated rules. Its steps are

$
  ⟨ M;(E;P);Delta ⟩ &arrow ⟨ E(M);P;Delta ⟩, \
  ⟨ M;(sf("defer")(p,w);P);Delta ⟩ &arrow ⟨ M;P;Delta ⧺ [(p,w)] ⟩.
$

A fresh attempt starts
with the original source for $K[S]$, their concatenated passes, and no deferred
rules. A failed attempt may stop at any prefix. A retry uses a strictly smaller
retained support and starts fresh again; its failed scratch state is kept only
as history. A completed attempt finalizes its scratch result. Here “completed”
means compilation has finished; Module admission is the subsequent check.

#theorem(name: "Replay refinement and history independence")[
  Every completed machine run from the fresh state for $B,K,S$ returns
  $sf("build")(B,K,S)$. If a history of partial failed attempts ends with a completed
  attempt at $S_f$, its result is $sf("build")(B,K,S_f)$, independently of its earlier
  selections and failure positions. Histories ending in the same retained support
  have equal outputs, with $B,K$ and their callbacks fixed.
]

#proof[
  Assign a meaning to each scratch state: collect its pending instructions,
  append the resulting rules after its accumulated rules, and finalize the
  resulting declarations. Both machine steps preserve this meaning. For an edit,
  the same function is moved from the pending sequence to the scratch Module;
  for a deferral, list associativity preserves the total rule sequence. At a
  fresh state this meaning is $sf("build")$; at a completed state it is the returned
  result. Induction over the attempt history discards each failed prefix and
  reduces to the final run. Equal supports select identical catalog entries.
  `machine_refines_build`, `attempts_refine_build`, and `history_independent` are
  in `Proofs/Plugin.lean`; support equivalence is in `Basics.lean`.
]

Total callbacks and a finite pending sequence ensure that a machine run completes.
Strict retirement decreases the cardinality of retained support, bounding retries
by the initial support size. It does not specify the policy for selecting a
usable subset or prove that subset maximal. An implementation must also recreate
or reset every stateful pass factory and cache used by an attempt; the theorem's
fresh scratch state cannot establish that fact about TypeScript by itself.

Source retention is necessary for general destructive transformations unless
some other history is retained. Two small counterexamples make the boundary
precise:

#theorem(name: "Output and DI dependencies do not determine undo")[
  Given distinct declarations $d_0,d_1$, deletion of $q$ has no common inverse
  $U:sf("Module") arrow sf("Module")$ satisfying
  $U(sf("remove")((lambda n . n=q),M))=M$ for every $M$.
  Moreover, a pass can produce different valid declarations depending on the
  presence of $x$, while its output has no declaration dependency on $x$.
]

#proof[
  Both $[q mapsto d_0]$ and $[q mapsto d_1]$ delete to $[]$; a single value $U([])$
  cannot recover both inputs. For the second claim, take distinct names $x,y$ and
  let a pass output $[y mapsto d_1]$ when $x$ is present, and $[y mapsto d_0]$
  otherwise. Choose well-formed $y$ and declarations with no requirements. Both
  outputs are valid and have no DI edge to $x$. Deleting $x$ from the first output
  leaves it unchanged, while a fresh run without $x$ produces the second output.
  These are `no_output_only_undo` and `di_graph_insufficient`.
]

The second example shows why the admitted DI graph alone cannot certify which
compile callbacks are unaffected by a configuration change. Incremental replay
would need a sound record of their observations, a restricted callback language,
or an independent equivalence check. Full replay provides the reference result
against which such an optimization can be judged.

Cordis 2026 #cite(<shi2026cordis>) is a close precedent, including reactive
coeffects, configuration reconciliation, and HMR. Its witnessed effect has type
$Gamma arrow Gamma times (Gamma arrow Gamma)$: applying an effect to $gamma$
returns $(delta,u)$ with $u(delta)=gamma$. The returned inverse may capture
information specific to that input. It therefore escapes the output-only
impossibility result: our counterexample does not apply to such retained undo
information. Cordis uses context-mediated effects to support runtime disposal
and reinstallation. Our declaration layer instead retains original source and
replays arbitrary pure transformations, including deletion and replacement,
without requiring each author to construct an inverse. These mechanisms can
coexist: replay determines the next plan, while tracked resources support runtime
cleanup during its installation.

== Hot Module Reload <hmr-guarantee>

The protocol in @hmr-semantics separates publication from the lifetime of code
still referenced by Tasks and recovery. This distinction matters after a
successful update as well as after a failure: removing an old generation from
the current pointer does not remove all references to its code.

#theorem(name: "Generation safety across handover and recovery")[
  Fix an immutable artifact graph $G$. If $H_0$ satisfies
  $sf("Safe")_G (H_0)$ and $sf("ValidPlans")(H_0)$, and
  $H_0 arrow^* H$ follows the protocol transitions, then
  $
    sf("Safe")_G (H) and sf("ValidPlans")(H).
  $
  Consequently, every published plan is valid; every artifact transitively
  reachable from a running Task's generation remains stored; and the code needed
  by a retained recovery generation remains stored, including in the degraded
  state after recovery itself fails.
]

#proof[
  First consider introducing a candidate bundle. Any artifact reachable in the
  new state is either reachable from the old roots or belongs to the bundle.
  Prove this by induction on its reachability path. At a new root the bundle
  premise applies. At an edge leaving a bundle artifact, the direct-dependency
  premise supplies another bundle artifact or an old reachable artifact; an edge
  leaving an old reachable artifact remains old reachable. The old invariant and
  the enlarged store therefore cover every case.

  Detach preserves phase roots. Commit, rejection, and either recovery outcome
  retain a subset of the preceding roots. Starting a Task copies roots from the
  current phase image; retaining a resource adds already reachable references.
  Finishing a Task or releasing a resource removes roots. Reclamation removes
  only an unreachable artifact, so it cannot remove one required by the invariant.
  These cases prove preservation of $sf("Safe")$. For plan validity, only prepare
  and repair introduce an image, and both require successful verification; all
  other transitions retain existing images. Induction on the transition sequence
  yields the result. The Task and recovery claims follow by embedding their
  roots into the global roots and closing transitively.

  The corresponding proofs are `step_safe`, `step_valid_plans`,
  `reachable_invariants`, `published_valid`, `running_task_retained`, and
  `recovery_retained` in `Proofs/HMR.lean`.
]

The recovery snapshot is retained explicitly in each failure phase. Recovery
constructs a fresh instance of the old generation; it does not resurrect a
disposed tree or roll back external writes. The result is a safety invariant,
with no promise of zero downtime, lifecycle success, or eventual collection. An
old Task that never finishes can keep its entire callable dependency closure
alive indefinitely.

Resource handover has a second, independent obligation. For a registry $r$, let
$sf("acquire")(r,k,t)$ install token $t$ at key $k$, and let
$sf("release")(r,k,t)$ clear it only when that token is still current.

#theorem(name: "Stale cleanup cannot release a successor registration")[
  If $t_n != t_o$, then
  $
    sf("release")(sf("acquire")(r,k,t_n),k,t_o)=sf("acquire")(r,k,t_n).
  $
  Releasing the current token does clear that registration.
]

#proof[
  At $k$, the stored token is $t_n$, so the stale release guard fails; at every
  other key release is the identity. The current-token guard succeeds.
  These are `stale_release_noop` and `current_release`.
]

Token freshness must survive key reuse for as long as an old disposer can run.
The registry theorem and artifact invariant model complementary parts of resource
ownership; their connection to actual callbacks is an implementation obligation.
Code retention also does not make a disposed service callable. Running Tasks
need a lifecycle discipline that preserves every capability they may invoke, or
an explicit rule preventing those calls. Equality of parked state shapes supplies
no behavioral compatibility proof for old Tasks and new code sharing mutable state.

= Position, cost, and implementation obligations <position>

== Relation to existing systems

The closest conceptual comparison is Cordis 2026, discussed in
@plugin-guarantee. Its HMR algorithm classifies modules, detects stale entries,
backs up module caches, and disposes and reinstantiates affected fibers; a failure
restores caches and recreates previous components #cite(<shi2026cordis>).
Our explicit degraded phase records that the recovery boot can fail as well.
The artifact invariant states an additional obligation for this application's
long-lived Tasks and recovery references; it is not a proof about Cordis's
implementation or a claim that Cordis lacks resource tracking.

Compiler passes over DI definitions are established industrial practice. Symfony
allows definition transformations before validation and instance creation
#cite(<symfony>), closely matching our structural compilation boundary. OSGi
Declarative Services specifies activation and deactivation in response to service
availability #cite(<osgi-ds>), and its framework lifecycle separates bundle revisions
and wiring during updates #cite(<osgi-lifecycle>). Erlang release handling provides
ordered upgrade instructions, versioned code, and application-controlled state
changes #cite(<erlang>). ZIO provides reloadable service layers #cite(<zio>).
These precedents rule out positioning mutable assembly plans or reloadable
services as new in themselves.

Dynamic software updating has also studied code replacement and state continuity
in depth. Kitsune updates C programs using update points and state transformation
#cite(<kitsune>); Theseus uses ownership and runtime state management to support
live evolution #cite(<theseus>). The survey by Ahmed et al. #cite(<dsu-survey>)
describes a broader range of techniques and constraints. These works are relevant
precedents, not a ranking of the latest systems: their execution models differ,
and this paper supplies no comparative evaluation or claim of academic superiority.

The useful position for this work is a checked account of PenguinHarness's own
composition boundaries. Deferred normalization explains which scheduling changes
are valid. Replay refinement defines the result that retry and incremental
implementations must match. Generation safety identifies the references that
must outlive a successful or failed handover. The counterexamples explain why
less information is insufficient. Pipeable notation follows familiar operator
APIs #cite(<rxjs>), and source retention draws on ordinary persistent-state
techniques #cite(<okasaki>).

== Cost <cost>

A counted refinement $⟨ P,M ⟩ scripts(⇓)_k (M',Delta)$ adds one per edit or deferral
and zero for the empty pass. Its count is exactly $k=|P|$, as proved in
`Basics.lean`. It counts scheduled instructions, excluding callback work,
finalization, and external checking. It gives neither a fuel limit nor a wall-time
bound for TypeScript execution.

For $n$ declarations in the final structural snapshot and $d$ deferred rules,
direct finalization evaluates $n times d$ selectors and performs one recipe
transformation per match. Expansion output size is the sum of callback output
sizes. Strict-retirement retries perform at most one more attempt than the initial
support cardinality, conditional on each attempt returning. Callback cost, provider
search, intermediate growth, and tsc must be measured separately. HMR retention
has no size bound without progress of Tasks and resource cleanup. No measured
performance or capacity claim follows from these operation counts.

== Proof correspondence and remaining obligations

The Lean package uses the standard library and the pinned toolchain. Every
stated theorem has a proof; no proof placeholder or additional propositional axiom
was introduced. Types, code, compatibility, and the checker are external parameters.
The sole domain-specific propositional axiom says that completed checker answers
agree with compatibility; standard Lean logical axioms remain part of the proof
foundation #cite(<lean4>).

#figure(
  tabular(
    columns: (1.45fr, 3.05fr),
    align: left,
    toprule(),
    [Paper content], [Lean files and principal results],
    midrule(),
    [Types, recipes, checker], [`External.lean`: `Ty`, `Code`, `Compatible`, `typeCheck_correct`],
    [Declarations and operators], [`Module.lean`, `Operator.lean`: edits, `Valid`, `verify`, `admit`],
    [Pass and plugin meaning], [`Pass.lean`, `Plugin.lean`: `Evaluates`, `materialize`, `build`],
    [Basic properties (@basics)], [`Basics.lean`: editing, verification, evaluation, selection, retry bounds],
    [Normalization (@normalization)], [`Proofs/Normalization.lean`: `collect_normal_form`, `reorder_invariant`],
    [Replay (@plugin-guarantee)], [`Replay.lean`, `Proofs/Plugin.lean`: `attempts_refine_build`, counterexamples],
    [HMR (@hmr-guarantee)], [`HMR.lean`, `Proofs/HMR.lean`: `reachable_invariants`, `stale_release_noop`],
    bottomrule(),
  ),
  placement: none,
  caption: [Correspondence to definitions and complete proofs. The artifact proves
    the model theorems; it does not establish a refinement by the TypeScript code.],
) <proof-map>

An elaboration relation must preserve qualified identities, contribution order,
provider choices, exports, aliases, and dependencies introduced by contributions.
It must account for multiple provisions sharing one instance, signature projection,
and the TypeScript questions actually generated. Pure, total callback semantics
must be justified for concrete factories; diagnostic provenance needs source and
edit histories. A valid output alone cannot show that the requested transformation
was performed.

The HMR model deliberately exposes a present implementation gap. The Plugin RFC
requires candidate compilation before dismantling the old runtime. In the
implementation accompanying this draft, `upgrade.ts` disposes the old tree before
successor boot, while `platform.ts` compiles the candidate inside that boot.
The stronger preparation order proved here is therefore a target protocol, not
an established implementation property. In-place package overwrite likewise does
not by itself retain the exact old revision needed for recovery. Neither gap is
repaired by adding a theorem about the abstract model.

A runtime refinement must also justify serialization, complete tracking of code
and disposer references, immutable revision identities, fresh registration tokens,
and the lifetime of capabilities used by old Tasks. The parked snapshot is opaque:
consistent capture, migration, and shared mutable state require further contracts.
The model neither verifies Node's module-cache behavior nor implements ESM unloading.
A transition indicates that a lifecycle callback returned; it cannot force that
callback to terminate or succeed. These are concrete conditions for using the
proved protocol as the foundation of the software.

#bibliography("module.bib")

#pagebreak()
#counter(heading).update(0)
#set heading(numbering: "A.1")
= Basic properties and proofs <basics>

This appendix records the algebra used by the main results. Full proofs are in
`Basics.lean`; the arguments below describe their structure. All callbacks are
pure and total, all sequences finite, and equality concerns semantic values.

== Operators and structural edits

#theorem(title: "Lemma", name: "Operator composition and locality")[
  For all $O_1,O_2,O_3,d$,
  $((O_1;O_2);O_3)(d)=(O_1;(O_2;O_3))(d)$, and
  $(sf("id");O_1)(d)=O_1 (d)=(O_1;sf("id"))(d)$.
  Moreover,
  $
    sf("at")_(q,O_1;O_2) = sf("at")_(q,O_2) compose sf("at")_(q,O_1).
  $
  The edit $sf("at")_(q,O)$ preserves $sf("names")(M)$ and $M(q')$ for $q' != q$.
  Let $sf("ctr")(⟨ tau;R;c ⟩)=(tau,R)$ and let $sf("CP")(O)$ mean
  $forall d, sf("ctr")(O(d))=sf("ctr")(d)$.
  Then $sf("CP")(sf("recipe")_w)$; $sf("CP")(O_1)$ and $sf("CP")(O_2)$ imply
  $sf("CP")(O_1;O_2)$; and $sf("CP")(O)$ implies
  $(⊢ sf("at")(q,O,M) sf("ok")) ⇔ (⊢ M sf("ok"))$.
]

Contract preservation concerns the declared $(tau,R)$ fields. It supplies no
behavioral equivalence of the recipes, and general $O$ need not satisfy it.

#proof[
  Expand composition to function application for associativity and the identities.
  For application at $q$, induct on the Module and split on whether the head name
  equals $q$. The same split preserves other names and their first lookup. A recipe
  operator changes only $c$; composition preserves $(tau,R)$ when both factors do.
  Mapping such operators preserves name validity, provider contracts, requirement
  lists, and the dependency relation. The same decreasing rank therefore witnesses
  validity in both directions. See `on_composition`, `on_local`, `valid_map`, and
  `on_preserves_validity`.
]

#theorem(title: "Lemma", name: "Editing laws")[
  For pure entry predicates $p_1,p_2$ and fixed name predicates $u,v$,
  $
    sf("filter")(p_2,sf("filter")(p_1,M)) &= sf("filter")(p_1 and p_2,M), \
    sf("remove")(u,sf("remove")(u,M)) &= sf("remove")(u,M), \
    sf("remove")(v,sf("remove")(u,M)) &= sf("remove")(u or v,M) \
      &= sf("remove")(u,sf("remove")(v,M)).
  $
  Removal retains exactly those names failing its predicate.
  $sf("replace")_(q,d)$ preserves the name sequence and lookup outside $q$.
  $sf("filterAt")_(s,p)$ agrees with $sf("filter")_p$ on $M[s]$ and preserves lookup
  outside $s$. For unique names and a present $q$ directly in $s$,
  $
    |(sf("remove")((lambda x . x=q),M))[s]|+1=|M[s]|.
  $
  Finally, $|sf("expand")(h,M)|=sum_((q mapsto d) in M)|h(q,d)|$.
]

Here conjunction and disjunction are pointwise predicate combinations. A callback
$f$ that inspects the changing Module does not inherit the fixed-predicate laws.
The equations concern values; they establish no allocation or structural-sharing
bound for a particular persistent representation.

#proof[
  Induction on the entry sequence reduces filter fusion and the deletion equations
  to Boolean identities on each unchanged entry. Membership follows from the
  filter predicate. Replacement maps names to themselves, and induction on first
  lookup proves locality. Slot filtering splits on the parent scope; inside the
  scope it is the ordinary filter, and outside it the entry is unchanged. For the
  cardinality equation, uniqueness permits exactly one matching entry, so removing
  it decreases the slot count by one. Expansion is concatenation of callback
  outputs; induction and additivity of list length give the sum. These arguments
  prove `filter_fusion` through `expansion_size`.
]

== Verification and admission

#theorem(title: "Lemma", name: "Verification and admission")[
  $V(M,pi)=sf("true")$ implies $⊢ M sf("ok")$.
  Conversely, $⊢ M sf("ok")$ and completed answers for every required comparison
  imply $exists pi, V(M,pi)=sf("true")$. Accepted requirements resolve to visible
  providers with compatible contracts, and $⊢ M sf("ok")$ excludes a dependency
  cycle. If a required comparison is $sf("unknown")$, then $V(M,pi)=sf("false")$.
  Also,
  $
    V(M_n,pi)=sf("false") &⇒ sf("admit")(M_c,M_n,pi)=M_c, \
    ⊢ M_c sf("ok") &⇒ ⊢ sf("admit")(M_c,M_n,pi) sf("ok").
  $
]

#proof[
  For soundness, extract unique names and completed positive dependency checks
  from the checker's conjunction. The external axiom turns each positive answer
  into compatibility. Use the position of each name in $pi$ as its rank; every
  dependency points to a smaller position. For completeness, sort the finite name
  sequence by a rank witnessing validity. A strict rank decrease places every
  provider before its consumer, and completed comparisons must answer positively
  for compatible contracts. A cycle would induce a strict rank decrease back to
  its starting point, which is impossible. An unknown comparison fails the
  checker's conjunction. Finally, admission returns either the verified candidate
  or the assumed-valid current Module. These are `verify_sound`, `verify_complete`,
  `valid_has_no_dependency_cycle`, `incomplete_dependency_rejected`, and
  `admission_preserves_validity`.
]

== Pass evaluation and deferred operators

#theorem(title: "Lemma", name: "Finite evaluation and composition")[
  For every finite $P,M$ there exist unique $M',Delta$ such that
  $⟨ P,M ⟩ ⇓ (M',Delta)$.
  The recursive interpreter agrees with this relation. Concatenation $⊙$ is
  associative. If $⟨ P,M ⟩ ⇓ (M_1,Delta_1)$ and
  $⟨ Q,M_1 ⟩ ⇓ (M_2,Delta_2)$, then
  $
    ⟨ P ⊙ Q,M ⟩ ⇓ (M_2,Delta_1 ⧺ Delta_2).
  $
]

The decreasing structure is the remaining pass sequence. There is no fuel limit
or bound on Module size; the embedded callbacks must already be total. A counted
refinement of this judgment is given in @cost.

#proof[
  Induct on $P$. The empty pass has the unique Done derivation. An edit applies its
  total callback and uses the induction hypothesis for the tail. A deferral uses
  that hypothesis and prepends its pair. Inverting any competing derivation fixes
  the same constructor and tail result, proving uniqueness. The interpreter
  follows these cases, so induction also proves agreement. Induction on the left
  pass proves concatenation associativity and the collection equation. In the
  counted judgment, each constructor consumes one instruction, yielding exactly
  $|P|$. See `evaluates_terminates`, `evaluates_unique`, `collect_correct`,
  `collect_append`, and `evaluates_steps`.
]

#theorem(title: "Lemma", name: "Final recipe application")[
  $sf("sel")(Delta,q,d)$ retains exactly the accepting occurrences of $Delta$ in
  their original order. Extending $sf("ctr")$ entrywise to retain names gives
  $sf("ctr")(sf("finalize")(Delta,M))=sf("ctr")(M)$ and
  $(⊢ sf("finalize")(Delta,M) sf("ok")) ⇔ (⊢ M sf("ok"))$.
  If $⟨ P,M ⟩ ⇓ (M',Delta)$ and
  $M'(q)=⟨ tau;R;c ⟩$, then
  $
    (sf("run")(P,M))(q)=⟨ tau;R;w_j (dots w_1 (c) dots) ⟩,
  $
  where $[(p_1,w_1),dots,(p_j,w_j)]=sf("sel")(Delta,q,M'(q))$; for $j=0$ the
  recipe is $c$. In particular,
  $sf("run")(sf("defer")(p,w);E;epsilon,M)=sf("finalize")([(p,w)],E(M))$, and
  $q ∉ sf("names")(M')$ ⇒ $q ∉ sf("names")(sf("run")(P,M))$.
]

#proof[
  Selection is a list filter on the unmodified structural entry, so it preserves
  accepting occurrences and order. Induct on the selected list to compute its
  left fold: each step changes only the current recipe and adds the next outer
  wrapper. Mapping this computation preserves names and contracts, so `valid_map`
  gives validity equivalence. Interpreter agreement identifies the structural
  result of any derivation, and lookup through the map yields the stated recipe.
  The later-edit example follows by evaluating collection; name preservation
  gives absence of removed targets. See `selected_exactly`,
  `selection_preserves_order`, `fold_recipe`, `materialize_preserves_validity`,
  and `final_recipe_operators`.
]

== Plugin selection and retirement

#theorem(title: "Lemma", name: "Selection and installation")[
  With fixed $B,K$, equal $sf("support")(S_1)$ and $sf("support")(S_2)$ give equal
  $sf("build")(B,K,S_1)$ and $sf("build")(B,K,S_2)$. Selected plugin names are unique
  when catalog names are unique, and every selected name is requested.
  Repeated installation or removal is idempotent with respect to the rebuilt
  result. For $q ∉ sf("support")(S)$,
  $
    sf("build")(B,K,(S+q)-q)=sf("build")(B,K,S).
  $
  A plugin named $q$ is absent from $K[S-q]$. A known plugin remains selected
  while its name occurs in any remaining Project request sequence.
]

The premise on $q$ is necessary for the round trip. Fixed $K$ also fixes revisions,
callback configuration, and precedence; upgrading a package or disabling only its
pass changes that parameter. These equations compare declarations, not live heaps.

#proof[
  Selection filters the fixed catalog by requested membership. Equal supports
  therefore produce equal ordered selections, hence the same source and Pass.
  A subsequence of unique catalog names remains unique, and filter membership
  implies the request is present. Installation and removal have the stated
  support equations; under freshness, adding and then removing $q$ restores the
  old support. Membership in any remaining Project request puts the known plugin
  in the union and therefore in the selection. See `build_depends_on_selection`,
  `install_then_uninstall`, `install_idempotent`, `uninstall_idempotent`, and
  `remaining_request_retains_plugin`.
]

#theorem(title: "Lemma", name: "Strict retirement")[
  Define $S' ≺ S$ by
  $sf("support")(S') ⊊ sf("support")(S)$. This relation is well founded.
  A chain $S_m ≺ dots ≺ S_0$ has
  $m <= |sf("support")(S_0)|$ strict transitions.
]

#proof[
  Deduplicate each request sequence to measure its finite support. Strict inclusion
  supplies an element of the old support absent from the next one, so the next
  cardinality is strictly smaller. Pull back the well-founded order on natural
  numbers along this measure. Induction on a retry chain adds one for its first
  strict decrease and bounds the remaining chain by the next cardinality. These
  are `retirement_decreases`, `retry_wellFounded`, and `retry_bound`.
]

Reordering requests or dropping a duplicate does not satisfy $≺$.
A policy that drops original contribution groups without removing a plugin needs
a measure that also counts those groups. The current statement does not cover
that policy or promise the largest usable subset.
