# Method and provenance

The sources are [OpenSkill v1](https://arxiv.org/abs/2606.06741v1), §2 and Appendices A.5, B and F, and [OpenLAIR/OpenSkill at 84ca182](https://github.com/OpenLAIR/OpenSkill/tree/84ca182da055fafb6453dcec4a6defdbbfd987c1). This implementation commit identifies the algorithm reference, separately from the task-source commit selected by a Benchmark.

Preserve these properties:

- Fixed model weights; reusable Skills are the learned artifact.
- Domain research and a separate retrieval pass for verification anchors.
- A fixed plan of 1–4 Skills and a persistent creator for each construction Case.
- Independent, executed virtual tests without target-task supervision.
- Failure-driven repair, `SELF-FIXABLE` / `NEEDS-DR` classification and bounded targeted searches.
- Export of the last revision, with the retry cap checked before the next verification.
- All construction frozen before fresh target evaluation.

Appendix F mentions a ground-truth pass/fail bit, while §2 and Appendix B describe supervision-free construction. The inspected implementation's OpenSkill override exits on surrogate success before the inherited ground-truth oracle. This toolkit follows §2 and that override: no target score, including an available training-judge score, enters construction.

## Penguin adaptations

Penguin supplies the configured models, tools, Sessions and execution environments. Its controller assembles a library across construction Cases and routes it using public applicability descriptions. With paired Train/Test packages, public Train inputs support construction and the frozen library transfers to held-out Test tasks. Record this transfer setting separately from same-task deployment.

The experiment constructs once per independent benchmark/training unit and tests each frozen baseline/final State three complete times by default. These are repeated tests of one learned library, not independent learning runs. Runtime limits come from the user and Benchmark contract. Record the resolved configuration and any unsupported capability.

Virtual verification and official Benchmark scores remain separate. An executable check can be wrong; a passing proxy does not establish a target pass. Retain source evidence, coverage limitations and the final revision's tested status in the report.
