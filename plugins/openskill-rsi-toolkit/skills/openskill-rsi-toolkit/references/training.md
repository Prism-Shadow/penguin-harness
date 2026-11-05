---
name: openskill-training
description: "Research reusable Skills, revise them in a persistent creator Session using independent virtual tests, and export the last revision without target supervision."
---

# Learn with OpenSkill

You coordinate construction for one training unit. Use the supplied public tasks, runtime, budgets and export locations. Keep one persistent creator per construction Case; revisions continue that same conversation. Independent verifiers receive their own contexts. The outer controller freezes the combined library and arranges official evaluation after construction ends.

## Research and plan

1. Form domain questions from public inputs. Remove Benchmark names, Case ids, task-repository URLs, exact titles and distinctive solution-locating text from every search, including follow-up searches. Discard target answers, hidden tests and solver traces encountered in results. If construction has already consumed them, stop the affected Case and exclude its contaminated artifacts from supervision-free learning; any restart needs an uncontaminated context.
2. Retrieve documentation, papers, public examples or APIs and write knowledge notes with source links. Model recollection alone does not replace retrieval. Retain the full allowed inputs for practice even when using short previews for research planning.
3. Fix a plan of 1–4 Skills per construction Case: stable names, responsibilities, applicability, procedures and needed resources. Keep this decomposition through refinement.
4. Make a separate verification-research pass. Find documented schemas, independently computable examples, invariants or alternative implementations. Explain how each anchor supports an expected result. Expected values cannot come from the creator's current answer.

## Create and practice

Give the creator the public task, knowledge, fixed plan and allowed tools. It writes portable Skills with `name`, `description` and useful task-solving instructions, plus resources actually needed by those Skills. Instance answers and experiment paths stay in learning records.

Have the same creator apply the current Skill revision to the public construction task, writing a new practice output. Keep the Skill fixed during that attempt and retain the actions, output and resource usage. Subsequent feedback revises the reusable Skill; practice then starts with a new output. Preserve the benchmark environment's documented state semantics.

## Independent virtual verification

Give a separate verifier the public requirements and independently retrieved anchors. Have it establish expected behavior before inspecting candidate outputs, then write and execute deterministic checks on those outputs. Use an appropriate test runner and retain its raw results. The default limit is 60 checks per verification.

The verifier must not use target scores, private rubrics, reference solutions or the official training judge. Avoid inferring hidden business policy from an output. Record unsupported requirements as unresolved instead of inventing expected answers. A passing subset establishes only the checks actually supported and executed.

Distinguish a genuine assertion failure from a broken verification script or an execution error. Correct an evidenced verifier fault without weakening a valid check. An unexecuted or broken suite is not a measured pass.

## Feedback and revision

On failure, retain the observed evidence and classify the needed repair:

- `SELF-FIXABLE`: the existing knowledge is sufficient to revise the Skill.
- `NEEDS-DR`: a specific knowledge gap calls for targeted retrieval. Retrieve relevant evidence within the search budget, then send it with the diagnosis to the same creator.

If classification fails, use `SELF-FIXABLE`, as the reference implementation does. The default allows up to three targeted searches per Case. Failed searches consume their request but provide no knowledge.

The persistent creator revises the reusable Skill or its resources and applies it again. Keep each revision, its rationale and its fresh practice output. Do not patch an answer by hand and describe it as a new Skill execution. Do not force an edit merely to produce an apparent evolution curve.

The reference implementation checks the retry cap before the next verification. With the default cap of three failed verifications, the third failure may trigger a final revision that is exported without a fourth verification. Preserve this ordering and explicitly distinguish the final revision from the last tested revision.

Stop early on virtual success, or when the declared retry or time budget is exhausted. Exhausting the search allowance stops further searches, not supported repairs: use the last search's evidence and continue `SELF-FIXABLE` work within the remaining refinement/time budget. Record gaps that still require unavailable research. Keep the **last valid revision**, even when an earlier revision had a better virtual result. A broken or missing Skill is a construction failure; a valid final Skill with unresolved virtual failures remains a reportable output. Record partial coverage, untested changes and the stop reason.

## Export

Return each Case's last Skills and the complete revision, retrieval, practice and verification records. Deployed Skills contain reusable content and required resources only. Keep answers, tests, scores, diagnoses and conversation history in the separate learning record.

Report actual virtual measurements, failed assertions, unresolved expectations, revisions and per-unit cost, time and token usage. Virtual pass rate is a proxy, not the target Benchmark score. Once the outer controller freezes the library, official baseline/final evaluations cannot provide further learning feedback.
