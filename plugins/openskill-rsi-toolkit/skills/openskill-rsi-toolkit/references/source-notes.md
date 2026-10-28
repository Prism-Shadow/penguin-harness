# Algorithm and Penguin adaptations

The source is [OpenSkill: Open-World Self-Evolution for LLM Agents, v1](https://arxiv.org/abs/2606.06741v1),
§2.1–2.2 and Appendices A.5, B and F. The inspected reference implementation is
[OpenLAIR/OpenSkill at 84ca182](https://github.com/OpenLAIR/OpenSkill/tree/84ca182da055fafb6453dcec4a6defdbbfd987c1).
The source revision is algorithm provenance, not a benchmark-source pin.

## Preserved properties

| Property | Paper | Penguin implementation |
| --- | --- | --- |
| Fixed weights; reusable learned skills | §2.1 | Target skill library; no weight updates |
| No target supervision during construction | §2.1–2.2, B.3 | No scores, hidden tests, answers or training-judge feedback before global freeze |
| Domain research and separate verification anchors | §2.2.1, B.1–B.2 | Two research passes with solution-identifying queries removed |
| Fixed decomposition and persistent creator | §2.2.2, B.1, B.4 | 1–4 skills per construction Case; one creator Session across revisions |
| Independent deterministic virtual tests | §2.2.2, B.3 | Independent verifier, reviewed evidence, measured pytest/JUnit results |
| Failure-driven correction and targeted research | B.5 | SELF-FIXABLE / NEEDS-DR feedback to the same creator |
| Last revision export | §2.2.3, B.6 | No best-of-N selection or rollback to an earlier virtual winner |
| Frozen skills before fresh target execution | §2.2.3, B.6 | Global freeze before Baseline and final evaluation |

The reference implementation's retry cap is checked before the next verification. A final
failed verification can therefore trigger one last edit exported without another test. The
executor preserves this ordering and distinguishes the final and last-tested revisions.

Appendix F mentions a ground-truth pass/fail bit, in tension with §2 and Appendix B's
supervision-free construction. The OpenSkill override in the inspected implementation exits
on surrogate success before the inherited ground-truth oracle. This port follows §2 and
that override: no ground-truth bit enters construction, including a GDPevo training score.

## Declared adaptations

- Penguin's configured models, tools and SDK replace the paper's particular research and
  creator endpoints. Record actual identities; do not claim those endpoints were used.
- Separate Docker role environments, immutable input views, runtime fingerprints and an
  append-only journal enforce execution boundaries. The controller and reviewed images
  remain trusted. Hashes do not establish semantic independence or correct tests.
- Evidence review checks a verifier's declared expectations before it sees candidate
  outputs. Unsupported business rules remain unverified; they never become guessed gold.
- `bounded-evidence-v2` also routes an observed, evidenced skill defect into revision when
  the current proxy passes. The creator must change the relevant resource, reapply it and
  obtain independent regression evidence. Unknown policy alone does not require a revision.
  A documented research fallback stays within the original attempts and deadline.
- Graded recovery handles local invocation errors and bounded execution/verifier repair.
  These engineering allowances are reported separately from learned skill revisions. They
  never reset the retry/search budget or turn an interrupted run into a virtual pass.
- Required-check coverage is stricter than assertion pass rate alone. `evidence_limited`
  retains unsupported requirements and is not full acceptance or benchmark correctness.
- A Target-owned wrapper routes a combined library by public applicability. It is deployment
  plumbing, not a learned fifth skill. A fresh Target matches the no-initial-skills setting;
  reusing existing domain skills is a warm-start adaptation.
- Native GDPevo groups several training questions in one published construction Case. Its
  paired Test package is held out until freeze. The real training judge is disabled, so this
  is OpenSkill virtual construction followed by transfer evaluation, not the benchmark's
  optional supervised continuous-training protocol. Report Case and question counts.
- Baseline comparison occurs after global freeze. Construct once per Benchmark/training
  unit and evaluate the same frozen States three times by default, unless the user supplies
  another count. This replaces the paper's five-run default and does not repeat construction.
  Report the sample standard deviation of complete-test repetition scores; it is not
  across-training-run variability. Keep the published manifest's run count as provenance.
  An explicitly requested empty-reader control is an additional post-freeze ablation.
- Construction uses a 360-minute deadline per Case by default; a shorter smoke limit requires
  an explicit request. Issued targeted searches, including empty responses, are capped.
  These engineering limits replace the source's episode counters and do not change the
  Benchmark's final evaluation timeout. None guarantees a successful repair or a minimum
  number of revisions.

Report virtual verification, execution recovery, actual skill revisions and final scores
separately. A passing proxy can be wrong, and a failed assertion can reflect a verifier defect.
The controller must inspect evidence; structural checks do not prove causal improvement.
Existing journals retain their recorded policies and are never migrated or reopened by this port.
