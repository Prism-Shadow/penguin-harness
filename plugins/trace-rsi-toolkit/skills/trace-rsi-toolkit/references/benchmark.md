# Resolve the published Benchmark

Read the selected Project's `benchmark_config.toml` and Case `statement/README.md`, then the linked repository README, public task manifest and adapter documentation. These define task paths, input access, feedback, scoring, exports and runtime limits. TRACE defines the learning procedure.

Resolve the matching Train/Test packages, the continuous training entry point and its constituent questions, native trial/result locations, State import contract, model connection and executable installation. Prefer user-specified source versions; otherwise follow the package's branch, tag or commit link. Fetch once and record the resolved commit, then use that checkout throughout the experiment.

## Current GDPevo layout

GDPevo publishes separate benchmark directories for `gdpevo-crm`, `gdpevo-erp`, `gdpevo-finance`, `gdpevo-healthcare`, `gdpevo-legal` and `gdpevo-data-analysis`. Resolve legacy group numbers through the published mapping.

For each selected benchmark, read `benchmarks/<benchmark-id>/tasks/task_group.yaml`. Its training-run entry identifies the continuous task; in this layout it is `train_tasks`. Independent test tasks are under the same `tasks/` directory, with domain-prefixed names such as `finance-test-001`. Do not construct paths from the old `task_group_NNN/tgNNN-train` layout.

A Train package can expose one Case containing five questions; that is one training invocation, not five Harbor training trials. Build the Curator's brief from learner-facing inputs and the permitted feedback interface. Manifest references to grader sources or reference answers are not training material.

## Runtime and handoff

Use the documented runner and adapter. Training requires a continuing Curator session, fresh Actor child sessions in the same business environment, and the feedback TRACE needs. If this contract is unavailable, report the incompatibility rather than silently replacing it with independent reset trials.

Apply the benchmark's time, turn and network settings. Unlimited turns do not remove a wall-clock cap. If direct Docker access fails due to socket permissions, try `sudo docker`; when invoking Harbor/Compose with sudo, preserve required configuration using the documented mechanism, such as an explicit Compose env file.

Keep trial concurrency distinct from physical container capacity: account for runner sidecars as well as business containers. Training and testing share the available capacity; reduce simultaneous launches if necessary.

Collect native artifacts before creating frozen test States. A combined Train/Test job does not transfer learned Skills automatically. The final training verifier scores the exported answers, while TRACE's stage measurements and selection come from the internal training records. Preserve both.

Follow the repository's retry rules and retain failed attempts. A run that has already begun solving is not an unused attempt; any exception needs the user's authorization unless already covered by the experiment policy.
