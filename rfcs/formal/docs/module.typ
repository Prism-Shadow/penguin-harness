#import "@preview/faithful-acmart:0.2.0": *

// Governing specifications: ../../PRFC-0001-module.md,
// ../../PRFC-0003-plugin.md and ../../PRFC-0025-module-pass.md, revision v2.3.0.
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
  title: "Declarations, Operators, and Replay in a Module Mechanism",
  subtitle: "A model and theorem-statement draft for PenguinHarness",
  short-title: "Module Semantics: Design Draft",
  authors: (),
  abstract: [
    PenguinHarness assembles components from declarations, operators, interface
    signatures, dependency resolution, compile passes, and runtime lifecycle rules.
    Instrumentation must cover declarations introduced by later passes, while mocks,
    contribution removal, and plugin uninstallation require structural changes.
    We specify a finite declaration model with ordinary and deferred recipe
    operators. Edits may temporarily violate contracts; admission checks the
    final result using an external TypeScript compatibility relation. Plugin changes
    rebuild from the original declarations. A shared abstract syntax, direct operator
    application and big-step Pass evaluation explain a worked example of mock
    replacement, tab removal, telemetry and plugin removal. The paper makes the
    intended value and its conditions explicit. Existing theorem candidates are restated in that syntax;
    theorem selection and all proofs remain deferred. Source elaboration, diagnostic
    provenance, and runtime recovery require additional arguments.
  ],
  keywords: ("module systems", "operators", "rewriting", "plugin reconfiguration", "Lean"),
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

We use four requirements to evaluate the design:

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

The proposed mechanism uses one immutable declaration representation, finite pass
composition, an explicit boundary for deferred operators, and rebuilding from source.
Its intended value is to make the effects of a composed change inspectable: which
entries remain, which recipes are wrapped, which dependencies must check, and
which inputs determine a rebuild. It does not prescribe a query-language-only
API. Pure, total callbacks remain expressible, while the common operations have
names that expose their scope.

The contribution of this draft is a shared syntax and an account of how these
choices address R1--R4. @syntax defines the shared declaration syntax;
@semantics interprets it and follows one example through mock replacement,
tab removal, telemetry, verification, and plugin removal. @candidates
records the existing candidate laws in that same notation. Their selection and
priority remain open; the candidates are grouped by the semantic boundary they
concern.

== Scope of the claims

Module, Operator, Pass, and Plugin are domain concepts. Names, contracts,
requirements, and recipes are data within them. Source, intermediate, and accepted
snapshots use the same Module representation; validity is a judgment about that
representation. Class and field annotations are one way to express declaration
construction and operator application. Their elaboration must preserve identities,
contracts, scope, and logical operator order.

This draft studies declaration operations. It does not yet establish the
elaboration from class syntax, diagnostic provenance, or runtime park/load and
resource reclamation. The external TypeScript assumption concerns completed type
comparisons. All accompanying Lean theorem bodies remain `sorry`. The equations
below define the semantics; statements labeled “Candidate law” are unproved and
await a separate decision about which guarantees merit proof.

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

== Assessing the design against the requirements

#figure(
  tabular(
    columns: (0.4fr, 2.4fr, 2.2fr),
    align: left,
    toprule(),
    [Need], [Observable result in the example], [Condition or remaining obligation],
    midrule(),
    [R1], [$M_2$ retains the mock store and help tab; the debug tab is absent.],
      [Stable contribution identities and immutable snapshots.],
    [R2], [$sf("run")(P_t,M_0)$ contains $w_t (c_m)$ after one finalization.],
      [All composed passes share one final boundary; callbacks are total.],
    [R3], [$M_1$ fails a requirement; the final result can still be admitted.],
      [Completed tsc checks, graph validation, and diagnostic provenance.],
    [R4], [Removing $q_t$ rebuilds $M_0$ from the same base and catalog.],
      [Retained source and fixed revisions; runtime recovery is separate.],
    bottomrule(),
  ),
  placement: none,
  caption: [Design value is assessed by observable behavior and its conditions.
    These worked evaluations are not claims of implementation correctness or
    measured performance.],
) <value-map>

This account makes the design choices testable before choosing proof priorities.
A candidate law is useful to the extent that it secures a required observation,
permits a justified optimization, or isolates an assumption an author must satisfy.
Whether each law below meets that criterion remains open.

= Candidate laws in the shared syntax <candidates>

The following groups restate the existing draft statements using @syntax
and the semantics of @semantics. They are an inventory for later selection,
not a selected set of contributions. All proofs remain deferred. Equality below
is equality of semantic results unless an expression explicitly denotes a sequence;
it does not identify different syntax trees by definition.

== Operators and structural edits

#theorem(title: "Candidate law", name: "Operator composition and locality")[
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

#theorem(title: "Candidate law", name: "Editing laws")[
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

== Verification and admission

#theorem(title: "Candidate law", name: "Verification and admission")[
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

== Pass evaluation and deferred operators

#theorem(title: "Candidate law", name: "Finite evaluation and composition")[
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

#theorem(title: "Candidate law", name: "Final recipe application")[
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

== Plugin selection and retirement

#theorem(title: "Candidate law", name: "Selection and installation")[
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

#theorem(title: "Candidate law", name: "Strict retirement")[
  Define $S' ≺ S$ by
  $sf("support")(S') ⊊ sf("support")(S)$. This relation is well founded.
  A chain $S_m ≺ dots ≺ S_0$ has
  $m <= |sf("support")(S_0)|$ strict transitions.
]

Reordering requests or dropping a duplicate does not satisfy $≺$.
A policy that drops original contribution groups without removing a plugin needs
a measure that also counts those groups. The current statement does not cover
that policy or promise the largest usable subset.

= Cost, correspondence, and remaining obligations <cost>

For operation counts, refine the structural judgment to
$⟨ P,M ⟩ scripts(⇓)_k (M',Delta)$. It uses the same rules with count zero for Done and
one added to the premise's count for Edit and Defer. Erasing that count gives
the earlier judgment:

$
  ⟨ P,M ⟩ ⇓ (M',Delta) ⇔ exists k, ⟨ P,M ⟩ scripts(⇓)_k (M',Delta).
$

#theorem(title: "Candidate law", name: "Operation count")[
  If $⟨ P,M ⟩ scripts(⇓)_k (M',Delta)$, then $k=|P|$.
]

The count measures scheduled pass instructions. It excludes callback work,
finalization and external checking; it is neither a fuel limit nor a time bound.

For $n$ entries in the final structural Module $M'$ and $d$ pairs in $Delta$,
direct finalization evaluates $n times d$ selectors and performs one recipe
transformation per match. $sf("expand")(h,M)$ has output size equal to the sum of its
callback output sizes. These quantities do not bound callback cost, provider
search, or tsc. The requested profiling workloads use interface catalogs of 5,000
and eventually 100,000 entries. Interface count alone determines neither Module
size nor the number of assignment questions; profiles must record intermediate
sizes, requirement sites, candidate comparisons, rendered declarations, and checker
work separately. No benchmark or measured capacity claim is made here.

The syntax is interpreted by the existing Lean definitions. The paper's three
checker answers correspond to `some true`, `some false`, and `none`; it assumes
only agreement of completed answers with compatibility. The structural judgment
corresponds to `Evaluates`, which hides the count in `EvaluatesIn`. The concrete
function and constructor names are mapped below so that implementation vocabulary
does not have to carry the exposition.

#figure(
  tabular(
    columns: (1.35fr, 2.65fr, 1fr),
    align: left,
    toprule(),
    [Paper notation], [Lean correspondence], [Status],
    midrule(),
    [$tau,c,≼,chi$], [`External.lean`: `Ty`, `Code`, `Compatible`, `typeCheck`], [External assumption],
    [$d,M,E$], [`Module.lean`: declarations and edits; $sf("at")$ uses `Operator.on`], [Definitions],
    [$sf("type"), sf("need"), sf("recipe"), O_1;O_2$], [`Operator.lean`: `withType`, `require`, `recipe`, `andThen`], [Definitions],
    [$epsilon,E;P,sf("defer")(p,w);P$], [`Pass.lean`: `done`, `edit`, `defer`], [Definitions],
    [$⇓,sf("finalize")_Delta,sf("run")(P,M)$], [`Pass.lean`: `Evaluates`, `materialize`, `run`], [Definitions],
    [$scripts(⇓)_k$], [`Pass.lean`: `EvaluatesIn`], [Definition],
    [$⊢ M sf("ok"),V,sf("admit")$], [`Module.lean`: `Valid`, `verify`, `admit`], [Definitions],
    [$g,K[S],sf("build"),≺$], [`Plugin.lean`: selection, rebuilding, `Retires`], [Definitions],
    [@candidates], [`Laws.lean`: the existing candidate statements], [Proofs deferred],
    bottomrule(),
  ),
  placement: none,
  caption: [Correspondence to the model. Every model file cites its governing RFC
    sections. The table is not a proof of source elaboration or implementation.],
) <proof-map>

To apply model laws to the production system, an elaboration relation must preserve
qualified identities, contribution order, provider choices, exports, aliases, and
dependencies introduced by contributions. It must account for multiple provisions
sharing one component instance. Signature projection and generated TypeScript
questions need a correspondence argument too. A subsequent implementation proof
could refine an executable verified core or check transformation evidence with a
verified checker. Output validity alone cannot establish that the requested edit
was performed.

Diagnostics need edit histories and source mappings. Runtime reconfiguration needs
admission, park/load, handover, boot failure, and recovery transitions. Reclamation
needs an explicit relation connecting artifacts to active or candidate generations,
Tasks, and recovery snapshots; eventual cleanup needs progress assumptions. These
obligations remain outside the current declaration model.

Pipeable authoring follows RxJS @rxjs; persistence motivates retaining earlier
snapshots @okasaki; Lean checks the definitions and statement types @lean4.
The requirements and worked semantics in the introduction and @semantics provide the
basis for choosing useful theorems. Proof priorities remain to be selected against
those requirements, independently of how easy a particular algebraic identity is
to prove.

#bibliography("module.bib")
