# Use an installed Benchmark

Read the selected package's `benchmark_config.toml` and Case `statement/README.md`. Follow their linked benchmark README and task manifest. These documents are the authority for task paths, environment access, feedback, scoring and exports; this toolkit supplies the learning algorithm.

## Discover the runtime

Resolve:

- The matching Train/Test packages and their native tasks.
- The continuous training entry point and the questions it contains.
- Input locations, business tools, training feedback and score aggregation.
- Answer and Skill exports, native result files and trace locations.
- Runtime installation, adapter options, network access and limits.

A package may contain one Train Case that includes several questions, and several independent Test Cases. Read that mapping explicitly. Do not derive it from an old task-group name or assume every directory is an independent training trial.

When statements link a task-source repository, require a full 40-character lowercase commit. The Task link, run-rules link and checkout instruction must name the same commit. Record the repository URL and commit, then fetch that checkout once; use it throughout training and every baseline/final test repetition. A user-specified version selects a matching package, not a different task revision beneath the installed statements. Do not follow branches or tags.

## Launch and collect

Follow the documented command and adapter. Launch the continuous training task once per benchmark or independent training unit, with the learner State archive and fixed runtime. The same training Session and business container remain alive across tasks and candidate edits. The learner may make task-focused calls inside that environment; it owns the learning iterations.

The runtime must support a continuing training environment and usable feedback. If it does not, report that incompatibility rather than silently changing training into independent reset trials.

Use native output paths returned by the runner. Collect the exported Skill folders and learning records before constructing frozen test States. A combined Train/Test job does not itself transfer learned Skills; the controller performs that handoff and then schedules three complete test repetitions per State by default. Each test attempt starts from the same frozen archive in a fresh environment and conversation.

Apply the benchmark's time and network settings. Count sidecars as well as business containers against the shared capacity limit. Follow its retry rules and retain failed attempts. Completed low-scoring answers are measurements; do not retry them as infrastructure errors.

The final training verifier grades the exported answers. It is distinct from the current/candidate measurements used by SkillAdam. Keep both and use the learning records to establish which iterations ran.
