# Evo learning roles

Supply each role's relevant instructions and allowed materials through the existing Penguin delegation tools. Preserve native Session and artifact identifiers so learning decisions can be related to actual executions.

## Solver and original-session reflection

Solve one public training task using the fixed pre-batch context and allowed business tools. Save the answer and obtain the actual authorized grade once. Read the complete feedback in this conversation.

Successful attempts produce no candidates. On negative feedback, reflect here with your actual task, actions, observations and submitted answer. Keep the model unchanged. Do not reconstruct the attempt in a fresh Reflector, rescore it, edit its answer or retrieve additional business evidence after grading.

Extract reusable lessons supported by that record. Connect the operation and outcome to the gap or useful substep, the proposed change and its applicability. Retain demonstrated useful behavior. A scalar score alone does not identify a failed field or prove the cause; distinguish observed facts from proposed repairs and preserve uncertainty.

Return zero or more candidates with:

| Field | Content |
| --- | --- |
| `id`, `task_id`, `attempt_id` | Unique candidate and source attempt identity. |
| `lesson` | Reusable procedure or proposed correction. |
| `trigger`, `scope_hint` | When the lesson applies, with necessary boundaries. |
| `evidence` | Relevant observed inputs/actions, answer or authorized feedback; distinguish observation from inference. |

Instance ids, dates, amounts and answer values stay in the evidence record. Genuine tool names and required domain concepts may remain in reusable instructions. An empty list is valid after reflection; do not invent lessons to fill a quota.

## Independent Evolver

Read the complete pre-batch private library, all negative candidates and all authorized training contexts. Successful contexts can constrain a lesson, but they do not create positive-source candidates.

Compile one decision set:

- **ADD:** introduce a supported method under a new id.
- **MERGE:** combine compatible lessons into an existing method while preserving their conditions.
- **REVISE:** replace an existing method with a supported correction.
- **SKIP:** omit unsupported, contradictory, duplicate or irrelevant content, with a reason.

Record the operation, source candidate ids, reason and complete replacement entry where applicable. Every candidate receives a decision; use it at most once per level. A candidate may support a general entry and a topic entry. Merge changes to the same target into one final replacement.

An entry has `id`, `level`, `trigger`, `scope` and Markdown `body`, plus a `topic` for topic entries or a self-contained `description` for general entries. Solvers see **all general descriptions and all matching-topic bodies**. General bodies stay private. Review the text actually visible to a Solver; a qualification hidden only in the private body does not constrain the exported description.

Preserve necessary premises, units, conditions and useful procedures. Walk the proposed visible guidance through the already available training evidence and counterexamples. This is reasoning over the completed batch, not another solve or scoring call. Keep uncertainty explicit and do not turn a one-instance answer into a general rule.

Use at most five general entries and five per topic. The complete reader, index and exported method files must fit 16,000 UTF-8 bytes. These are ceilings, not target counts. Resolve overflow through justified merging, revision or skipping; never silently truncate or drop methods during loading. Freeze the resulting library after this single compilation.
