# Resolve the published Benchmark

Read the selected Project's `benchmark_config.toml` and Case `statement/README.md`, then the linked repository README, public task manifest and adapter documentation. These define task paths, input access, feedback, scoring, exports and runtime limits. TRACE defines the learning procedure.

Resolve the matching Train/Test packages, the continuous training entry point and its constituent questions, native trial/result locations, State import contract, model connection and executable installation. For repository-backed tasks, require the full 40-character lowercase commit in the statement; the Task link, run-rules link and checkout instruction must name the same commit. Record the repository URL and commit, then fetch that checkout once, then use it throughout training and all baseline/final test repetitions. A user-specified version selects a matching package; do not substitute a branch, tag or task revision beneath the installed statements.

A Train package can expose one Case containing several questions. That is one continuous training invocation. Resolve its member tasks and independent Test Cases from the published instructions rather than constructing paths from names. Build the Curator's brief from learner-facing inputs and the permitted feedback interface; grader source and reference answers are not training material.

## Runtime and handoff

Use the documented runner and adapter. Training requires a continuing Curator session, fresh Actor child sessions in the same business environment, and the feedback TRACE needs. If this contract is unavailable, report the incompatibility rather than silently replacing it with independent reset trials.

Apply the benchmark's time, turn and network settings. Unlimited turns do not remove a wall-clock cap. Use the execution environment's configured runner access.

Keep trial concurrency distinct from physical container capacity: account for runner sidecars as well as business containers. Training and testing share the available capacity; reduce simultaneous launches if necessary.

Collect native artifacts before creating frozen test States. A combined Train/Test job does not transfer learned Skills automatically. The final training verifier scores the exported answers, while TRACE's stage measurements and selection come from the internal training records. Preserve both.

Follow the repository's retry rules and retain failed attempts. A run that has already begun solving is not an unused attempt; any exception needs the user's authorization unless already covered by the experiment policy.
