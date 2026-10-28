# PRFC-NNNN Title

- Feature Name: `kebab-case-identifier`
- Start Date: YYYY-MM-DD
- PRFC PR: [Prism-Shadow/penguin-harness-design#NNN](https://github.com/Prism-Shadow/penguin-harness-design/pull/NNN)
- Implementation PR: [Prism-Shadow/penguin-harness#NNN](https://github.com/Prism-Shadow/penguin-harness/pull/NNN)

> **Provenance marker** — Add after the document is migrated to the main repository:
> - Source: `rfcs/PRFC-NNNN-slug.md` from [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design)
> - State: landed on `main` / draft in design PR #NNN / open in design PR #NNN
> - Rev: v1.0.0

## Summary
[summary]: #summary

One paragraph explanation of the feature or design change.

## Motivation
[motivation]: #motivation

Why are we doing this? What use cases does it support? What is the expected outcome?

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

Explain the proposal as if it were already implemented and you were teaching it to another contributor or user. This generally means:

- Introducing new named concepts.
- Explaining the feature largely in terms of examples.
- Explaining how users or contributors should *think* about the feature, and how it impacts the way they use the system.
- If applicable, describe the impact on existing code, workflows, or user experience.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

This is the technical portion of the RFC. Explain the design in sufficient detail that:

- Its interaction with other features is clear.
- It is reasonably clear how the feature would be implemented.
- Corner cases are dissected by example.

This section should return to the examples given in the previous section, and explain more fully how the detailed proposal makes those examples work.

## Invariants
[invariants]: #invariants

Optional — omit this section when the design holds no property that must stay true permanently. Each invariant is one entry: a `### <invariant name>` heading, one sentence in a blockquote, then a short body.

```markdown
### <invariant name>

> <one sentence in the vocabulary of this RFC, stating what always holds and citing concepts as this RFC defines them>

<description — what the property asserts; explanation — how it reads across the concepts this RFC defines; why — what this RFC loses if the property is broken>
```

A statement belongs here when it passes three checks: **it speaks concepts** (every citation lands on a section of an RFC that defines the concept), **it matters** (break it and this RFC's purpose is lost), and **it survives implementation** (replace every file that implements the mechanism and the property still holds). An invariant is retired only by name, in a revision of the RFC that declared it, recorded under `## Changes`.

## Drawbacks
[drawbacks]: #drawbacks

Why should we *not* do this?

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- Why is this design the best in the space of possible designs?
- What other designs have been considered and what is the rationale for not choosing them?
- What is the impact of not doing this?

## Prior art
[prior-art]: #prior-art

Discuss prior art, both the good and the bad, in relation to this proposal. A few examples of what this can include are:

- Does this feature exist in other similar systems and what experience has their community had?
- Papers: Are there any published papers or great posts that discuss this?

This section is intended to encourage you as an author to think about the lessons from other systems, provide readers of your RFC with a fuller picture.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- What parts of the design do you expect to resolve through the RFC process before this gets merged?
- What parts of the design do you expect to resolve through the implementation of this feature before stabilization?
- What related issues do you consider out of scope for this RFC that could be addressed in the future independently of the solution that comes out of this RFC?

## Future possibilities
[future-possibilities]: #future-possibilities

Think about what the natural extension and evolution of your proposal would be and how it would affect the system as a whole. This is also a good place to "dump ideas" that you want to put on record, if they are out of scope for the RFC itself but related.

---

## Changes

### v1.0.0

- Initial version

<!--
When you modify this RFC after it has landed, increment the version number (e.g., v2.0.0) and document the changes in this section:

### v2.0.0

- Added: <description of what was added>
- Removed: <description of what was removed>
- Updated: <description of what was updated>

Keep each version's change items under a separate heading.
-->
