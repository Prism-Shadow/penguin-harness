# AWM initialization

Use [Penguin initialization](penguin.md) for Agent State and runtime. Initialize
only the empty workflow library and fixed reader before H1; do not invent learned
workflows. Their induction and format remain in
[AWM](../../agent-optimization/references/awm.md).
All `skills/` paths below are relative to the Target's `agent_state/`. Keep
initialization provenance outside that State and pass it to the Optimizer's OUT.

## Fixed reader and public index

Before measuring H1, create a target-owned `skills/awm-index/SKILL.md` with a
custom `YYYY.MM.DD.N` version, and `workflows.json` containing
`{"workflows": []}`. Index rows contain `id`, `description`, `revision`,
`content_hash`, `parameters`, and `dependencies`; never include training answers
or trace paths. Record ownership separately from the Target's public index.
Keep the live entries only in `workflows.json`; the reader Skill describes how to
load them without embedding a second copy of the empty or current index. An
inline example must not substitute for reading the actual file.

Use this fixed AGENTS.md instruction for both base and final harnesses:

> Before substantive task actions, read the complete awm-index SKILL.md and
> workflows.json. Read the complete SKILL.md of every indexed workflow
> and its dependencies before substantive task actions. Bind applicable workflow
> parameters to current observations. Use ordinary tools to execute applicable steps
> and verify completion. Record selected workflow IDs in a short task-workspace note, keeping the required final
> answer format. If none applies, solve normally. Do not modify persistent State,
> skills, memory, tools or hooks, and do not read experiment or private judge files.

Verify the empty index, custom Skill metadata and reader before handoff. Keep the
reader identical through training and independent testing. Do not reset an
existing learned library without a separately authorized initialization.
