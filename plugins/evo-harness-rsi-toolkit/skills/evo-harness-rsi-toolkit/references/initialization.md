# Prepare Evo-Harness

Resolve the Project from the Environment's App Data Dir. Read the selected `benchmark_config.toml`, Case statements and linked runtime instructions. These define task paths, Train/Test membership, environment access, training feedback, exports and scoring. A continuous Train Case may contain several questions; it is one learning trial.

For repository-backed tasks, use the full 40-character lowercase commit named by the Case. The Task link, run-rules link and checkout instruction must agree. Record the repository and commit and reuse that checkout for training and all tests. A requested task version selects a matching package. Display packages may be fetched from `main`; actual tasks follow their declared commit.

Fix the experiment/report version, actual component versions, model and thinking level, training roster/order, topic, negative-feedback predicate, limits and output paths. Prefer user-specified versions. Use the Project's configured connection through the supported runner; do not copy credentials into prompts or reports.

Use one fixed public topic per independent training unit, normally the selected Benchmark. All its Train and Test cases use that topic context. If the user or Benchmark explicitly defines multiple independent topics, establish their Train/Test membership as separate units before learning; do not change one frozen State's context between test cases or infer topics from scores.

Confirm that the complete authorized training grade can be delivered to the original Solver conversation, either directly or by continuing that Session with `input_subagent`. A post-exit-only verifier does not replace this requirement. Use the benchmark's own feedback interface; the toolkit does not supply another grader.

## Common base and training State

Use the requested base Agent or create a separate Target with the native CLI. Save the common base before adding learning instructions. Use experiment copies without old answers, mutable memory or state-changing hooks, and keep the solving configuration fixed.

Copy [training.md](training.md) into the training State as `skills/evo-training/SKILL.md`, with [roles.md](roles.md) beside it. Add a run configuration and a train-only benchmark brief giving the public inputs, business tools, permitted feedback call, score interpretation and export locations. Begin with an empty library unless a starting library was requested.

The main training Agent reads those instructions and coordinates one batch. Solvers receive their own task, the full Solver/reflection role, frozen pre-batch context and separate answer/record paths. Pass model and thinking level explicitly. Continue the original child Session for reflection; do not create a new Reflector. Run shared-state tasks in their declared order.

## Export and test States

Collect the private library, negative candidates, decisions, authorized feedback and native trajectories separately from the deployed Skills.

Export a root reader and the independent learned methods. Each method identifies its scope, trigger and topic when applicable. General methods expose their self-contained descriptions only; retain general bodies privately. Topic methods expose their complete bodies. Keep the entire exported package, including its reader and index, within 16,000 UTF-8 bytes. An empty library still has a valid reader and empty index.

Prepare baseline and final independently from the same common base. Both use the same fixed reader and context composition. Baseline retains the pre-learning library; final uses the exported result. Before a Solver or test Session starts, load all general descriptions and all matching-topic bodies into its initial context. Keep that exact context throughout its execution. Disable automatic extra Skill discovery for these solving States (`skills.enabled: false`) so no second selector changes this composition.

Install each method in its own native Skill directory and the fixed reader in its own directory. Add the explicit context block to the solving State's `AGENTS.md`; include every eligible method in full. Do not clip, select a subset or expose private general bodies to satisfy the size limit. The Evolver resolves size problems during compilation.

Record the exported library and State versions/digests. Test States contain no learning instructions, candidates, feedback, answers, conversations or mutable memory. Reuse the same frozen archives for every test repetition.

Follow the runner's State and installation contracts. For Penguin's Harbor adapter, `agent_state_tar` contains State files directly at the archive root. Keep credentials outside it. When a source-built runtime is requested, use the same executable installation bundle for training and testing via the documented `install_bundle` option; otherwise use the Benchmark's normal runtime.
