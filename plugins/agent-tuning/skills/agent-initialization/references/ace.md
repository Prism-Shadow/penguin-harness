# ACE initialization

Use [Penguin initialization](penguin.md) for Agent State and runtime. Prepare the
following method artifacts before the first measurement; run no training here.
The optimization method and rule schema remain in
[ACE](../../agent-optimization/references/ace.md).
Here `STATE` is the resolved Target's `agent_state/` directory.

## Empty playbook and fixed reader

Create `STATE/skills/ace-playbook/SKILL.md` as a target-owned custom Skill. Its
frontmatter has `name: ace-playbook`, a domain-specific description, and a
`YYYY.MM.DD.N` version following Agent Initialization. Keep custom Skill versions
separate from the integer Agent State version and rule revisions.

The stable body instructs the Target Agent to read `rules.yaml` in full, apply rules only
when their conditions match public evidence, check current authoritative business
sources, and solve normally where no rule applies. Start `rules.yaml` with
`entries: []`. Do not copy the Optimizer's reflection prompts into the Target Agent.

Before measuring H1, put this fixed instruction in the experimental Target Agent's
AGENTS.md:

> Read the complete ace-playbook SKILL.md and rules.yaml before substantive task
> actions. Apply applicable entries using the current business evidence. In a brief
> tool-side note in this task workspace, record rule IDs used and any conflicting
> observations; preserve the required answer format. Never modify Agent State,
> persistent memory, Skills, hooks or tool definitions. Do not read other cases,
> experiment records, judge endpoints or private scoring files.

Keep this reader unchanged across baseline, candidates and independent testing.
Verify `entries: []`, valid custom Skill metadata and the exact reader before
handing off H1. Do not clear an existing learned playbook; resume requires a
matching experiment or a separately initialized Target.
