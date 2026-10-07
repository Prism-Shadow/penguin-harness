# APE initialization

Use [Penguin initialization](penguin.md) for Agent State and runtime, and
[APE](../../agent-optimization/references/ape.md) for the method and sources.
Create the prompt slot only; generating instructions belongs to optimization.

Create a target-owned `skills/ape-instruction/SKILL.md` with a valid name,
domain description and `YYYY.MM.DD.N` version. Its fixed body instructs the Target
to read `instruction.md` in full and apply it to the current task within the
task's access and output requirements. An empty file means solve normally.
Initialize `instruction.md` as empty unless the user supplied a declared baseline
instruction. Keep the current text only in that file.

Before H1, add one fixed line to Target `AGENTS.md` requiring the Skill and its
instruction file to be read before substantive task actions. Keep that reader and
the Skill body identical for baseline, candidates and independent testing. Do not
put demonstrations, gold, candidate scores or proposal instructions into Target
State. APE's input/output examples belong in the authorized proposer context.

Verify empty or declared initial contents, valid metadata and the reader before
handing off H1. Preserve unrelated State, tools and model settings. Do not empty
an existing learned prompt: resume requires a matching experiment; a new search
needs a separate Target or explicit initialization scope. Return the State
version and initial instruction/reader hashes to the experiment record.
