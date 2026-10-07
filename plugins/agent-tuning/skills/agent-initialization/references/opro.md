# OPRO initialization

Use [Penguin initialization](penguin.md) for Agent State and runtime, and
[OPRO](../../agent-optimization/references/opro.md) for the method and sources.
Prepare one prompt slot before the initial measurement; run no search here.

Create the target-owned `skills/opro-instruction/SKILL.md` with a valid name,
domain description and `YYYY.MM.DD.N` version. Its fixed body tells the Target
to read `instruction.md` in full and apply that instruction to the current task
within the task's access and output requirements. Keep the learned text only in
`instruction.md`, not duplicated in the Skill body.

Seed `instruction.md` with the user's declared initial instruction, or the source
script's single seed, “Let's solve the problem.” Record which was used. Add a fixed
line to Target `AGENTS.md` requiring this Skill and its instruction file to be read
before substantive task actions. Keep the line and Skill body unchanged for H1,
every candidate and final testing. Optimizer prompts, score history and training
answers never belong in the Target's prompt slot.

Verify the files, metadata and reader before handing off H1. Preserve unrelated
State, tools, model settings and existing learned content. If the slot already
exists, reuse it only for an explicitly matching resume; otherwise request a new
experimental Target or an explicit initialization scope. Return the initial text
hash, reader hash, State version and source identity to the experiment record.
