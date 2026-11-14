# PRFC-0022 RFC Invariants: a permanent section for what must always hold

[中文版](PRFC-0022-rfc-invariant.zh.md)

- Feature Name: `rfc-invariants`
- Start Date: 2026-10-23
- PRFC PR: none yet (native to this repository)
- Implementation PR: — (carried by its own implementation pull request once this RFC lands)

## Summary
[summary]: #summary

This RFC adds an optional `## Invariants` section to the shape of a PRFC. An invariant is a named statement: one sentence in the RFC's own vocabulary, followed by a short explanation. The sentence states a property the design must always keep, and later RFCs, implementations and revisions read it as a check item. An RFC without such a property omits the section and stays complete.

## Motivation
[motivation]: #motivation

### A property that must always hold needs one citable sentence

A PRFC records a design decision: what the mechanism is, how its parts fit, where the edges are. A reader who finishes it can say what changed; the answer to "what must always hold about this design" stays scattered across the prose that describes the mechanism.

The occasions that need that sentence are concrete. A later RFC changing the same mechanism has to check whether it overturns an existing promise; an implementation has to judge whether a trade-off crosses a line; a revision has to say which promise it moved. Today all three re-read the prose and re-derive the answer, and the conclusion usually stays in the discussion, where the next RFC never sees it.

### A concrete example

[PRFC-0021-distros](./PRFC-0021-distros.md#guide-level-explanation) fixes the vocabulary of distro channels: six channels, each answering the same four facets. When a new way of shipping appears, it joins as a new channel and answers those four facets. Today that requirement lives only in the prose of the distros RFC; a new RFC that adds a channel and skips the facets has no sentence it can be measured against. Named, citable entries close that gap.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### An invariant is one statement

An invariant is a property the design must always keep, written as one sentence in the RFC's own vocabulary. It is a contract: later RFCs, implementations and revisions read it as a check item. It is independent of the implementation — replace every file that implements the mechanism and the sentence still holds.

### The shape of an entry

An entry is a small section: a name, one sentence in a blockquote, and a short explanation.

The entry below is hypothetical, shown for its shape:

```markdown
### Type relationships survive transforms

> With any transform, [`Module`s](./PRFC-0001-module.md#the-three-primitives) still keep correct type relationships.

<description — what the property asserts>
<explanation — how it reads across the concepts this RFC defines>
<why — what this RFC loses if the property is broken>
```

The sentence form is "whatever kind of change happens, this concept still holds". It is meant to be quoted whole: into a comment, the motivation of a later RFC, or the note of a revision.

### What qualifies as an invariant

Three checks:

1. **It speaks concepts.** Every citation in the entry lands on a section of an RFC that defines the concept. `Module` is a concept [PRFC-0001](./PRFC-0001-module.md#the-three-primitives) defines, so it can be cited; a same-named type inside one implementation file cannot, because the design surface gives the reader no way to check it.
2. **It matters.** Break the property and this RFC's purpose is lost. A statement that merely restates the mechanism, and whose breaking changes nothing, is out.
3. **It survives implementation.** Replace every file that implements the mechanism and the property still stands. A statement one refactor can break is a design detail and is out.

Beyond the three checks, an invariant has to be answerable as a question while the design is built: "does this design keep it?"

### Optional by design

A code change does not always carry a property worth keeping permanent. An RFC without such a property drops the section and stays complete. Forcing every RFC to write one would produce restatements of mechanisms; the value of this section comes from scarcity.

### How later RFCs treat an existing invariant

A later RFC first checks its design against the existing invariants and continues when they hold. To change a promise, it retires that invariant by name in its own body — which RFC declared it, which invariant, and why. The retirement raises the declaring RFC's revision and records the retirement under that RFC's `## Changes`.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Placement

`## Invariants` sits between `## Reference-level explanation` and `## Drawbacks`, with the anchor marker line `[invariants]: #invariants`. The reader meets the mechanism first and then what must always hold about it.

### The exact shape of an entry

One `### <invariant name>` per invariant, with the name in the document's language. The statement is one sentence in a blockquote, opening with the kind of change it addresses, for example: "However a channel is reshaped, … still …". The body is one or more paragraphs covering three things in any order: **description** (what the property asserts), **explanation** (how it reads across the concepts this RFC defines), and **why** (what this RFC loses if the property is broken). The body may cite RFCs and may discuss the current implementation; the statement sentence speaks only of concepts.

### Citation rules

Links point only at RFC anchors, written as `./PRFC-NNNN-slug.md#anchor`, and every anchor exists in the cited document. A citation never names a source file, a path, or an identifier of the implementation. When RFCs landing in the same batch cite one another, the citations are written as they will read once the batch has landed.

### Retirement

An invariant is retired only by name: a revision of the RFC that declared it names the invariant and the reason, records the retirement under that RFC's `## Changes`, and raises that RFC's version. Nothing else can retire an invariant.

### What this RFC changes in the RFC surface

`TEMPLATE.md` gains the `## Invariants` slot between `## Reference-level explanation` and `## Drawbacks`, with the entry shape and the three checks. This document is written in that shape and carries two invariants. Landed RFCs are not required to backfill.

## Invariants
[invariants]: #invariants

### Citations land on concepts

> However the implementation is organized, an invariant still cites the concept as an RFC defines it.

The citation rule is the property this section fixes. An invariant is read by people who were not there when the design was made; every citation is their path to the concept, and a citation into the implementation hands them a moving target. Open the door to implementation-level citations and the section drifts into restating whatever the code does today.

### An invariant binds later RFCs

> However a later RFC reshapes a mechanism, the invariants of the RFCs it builds on still hold, unless that RFC retires one by name and the declaring RFC records the retirement.

The binding is what separates an invariant from an observation. A later RFC that contradicts an invariant may well be right — designs do get overturned — and the contradiction still must be written down, owned, and recorded against the declaring RFC, so that what the harness actually promises stays knowable.

## Drawbacks
[drawbacks]: #drawbacks

The section adds a cost to writing and to reading, and weak invariants dilute its weight. The three checks guard the entrance, and judgment still rests with the reader. Retirement lets a later RFC drop promises one at a time; that is deliberate — a contract nobody can retire rots into a contract nobody reads, and silent breakage is the state this section exists to end.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**A dedicated section**: a property that must survive needs a stable anchor so later documents can cite it the way they cite a section; prose inside a mechanism paragraph has no anchor.

**One blockquoted sentence**: the statement can be quoted whole, and the assertion stays visually apart from its explanation.

**Optional**: forcing one per RFC would produce restatements; the value comes from scarcity.

**Natural language**: the design surface is prose, and the property must be judgeable by a reader.

**Other approaches considered**: a separate cross-RFC registry of properties, which loses locality — a reader of PRFC-0001 should meet PRFC-0001's properties inside it; test assertions, which bind to an implementation, the very dependency an invariant must not have; changelog conventions, which record change and cannot record permanence.

## Prior art
[prior-art]: #prior-art

Formal methods (TLA+, Alloy) separate properties from implementations and check the former against the latter; this RFC borrows the separation and none of the formalism. Eiffel's Design by Contract checks object invariants at every boundary — the nearest neighbour of "checked every time the design is read". The C++ standard's complexity guarantees are properties declared at the specification layer that every implementation must keep. Rust's stability tiers answer the same question — what is promised, and for how long — with a section a reader can cite.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

A few details are left to the implementation or to a later revision.

- Whether landed RFCs gain invariants retroactively; this RFC does not require it, and each would be its own revision.
- Whether citation shape can be checked by a tool: anchor existence can, the importance and survives-implementation checks cannot.
- Whether retired invariants leave a trace beyond the declaring RFC's `## Changes` — an index column, for instance.

## Future possibilities
[future-possibilities]: #future-possibilities

Tooling can check citation shape alone: no implementation files named, every anchor resolving. The section shape also generalizes to other surfaces that promise permanence — plugin contracts, machine protocols — if they grow RFC-shaped documents.

---

## Changes

### v1.0.0

- Initial version (draft, native to this repository).
