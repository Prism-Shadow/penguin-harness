# Prepare OpenSkill

Resolve the Project from the Penguin Environment's App Data Dir. Read the selected package's `benchmark_config.toml`, public Case statements and linked runtime instructions. They define task paths, environments, input/output contracts and the Train/Test relationship; OpenSkill defines how Skills are learned.

For repository-backed tasks, use the full 40-character lowercase commit named by the Case. Its Task link, run-rules link and checkout instruction must agree. Record the repository and commit and reuse that checkout throughout the experiment. A user-specified task version selects a matching package. Display packages may be obtained from `main`; task execution follows their declared commit.

Record the experiment/report version, actual Harness, runner, Benchmark, model and toolkit versions, thinking levels, selected Cases, budgets and resource limits. Prefer user-specified versions and record a model revision when exposed. Use one output directory per independent training unit and distinct output paths for each practice attempt and test repetition.

## Base State and construction inputs

Use the requested Target or create a fresh Agent through the Penguin CLI. Snapshot its State before learning. Prepare experiment copies with the same tools and solving instructions, without previous answers, mutable memory or state-changing hooks. Keep the controller separate from the measured Target.

Use the declared Train inputs for construction when Train/Test packages are paired. Read Test package metadata only to schedule later evaluation; keep held-out questions and scoring material out of construction. A published Train Case may contain multiple questions, which belong to that construction unit.

Stage only public instructions, permitted attachments and business-tool access. Do not carry curated solution Skills, private tests, scorer source, previous outputs or scoring logs into practice. Give the creator and verifier only the inputs their roles require. Their separate conversations do not by themselves isolate a shared filesystem; use the runtime's supported workspace/container boundaries for material that must be private.

Use an unscored practice path documented by the Benchmark. An evaluation command that automatically runs the official verifier is not a construction command. Do not call the real training judge, even when it is available. When unscored practice cannot be provided, record the unsupported capability before spending the construction budget.

## Learning handoff

Give the learner [training.md](training.md), a brief containing the public tasks, tools and deliverable locations, and the resolved settings. It retains a continuing learning Session and environment. Within each construction Case, retain the same creator Session across feedback revisions and use independent verifier contexts. Separate Cases keep separate creator histories.

Keep retrieved sources, knowledge notes, the fixed plan, every Skill revision, practice output and virtual-test result in the experiment directory. These are ordinary learning records; use the available Penguin tools and Benchmark runner to create them.

## Frozen test States

Once every Case finishes construction, package its last valid Skills, supporting resources and public applicability descriptions into the final library. Create a root `SKILL.md` explaining how to choose and read the relevant Skills. Keep the learning evidence outside this deployed folder. Record the final library and State versions/digests, and whether each final revision received virtual verification.

Prepare baseline and final from the same saved base. Baseline remains the pre-learning State; final adds only the frozen library and reader. An empty-reader control is optional when explicitly requested. Any reused domain Skills in the supplied base remain part of the reported baseline definition.

Keep the complete States frozen throughout testing. No learning history, answers, virtual tests, verifier reasoning or target feedback enters either State. Each test task and repetition gets a fresh environment and conversation.

Follow the selected adapter's State-import and executable-installation contracts. The Penguin Harbor adapter accepts State contents at the archive root via `agent_state_tar`. Credentials travel through the runner's private configuration transport, not prompts or archives. When a source build is requested, reuse the same prepared executable bundle for construction and testing through the documented `install_bundle` option; otherwise use the Benchmark's normal runtime.
