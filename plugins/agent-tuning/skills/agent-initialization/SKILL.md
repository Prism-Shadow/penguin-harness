---
name: agent-initialization
description: Initialize or extend an Agent from a requirement, using Penguin defaults or a method-specific reference for its baseline harness.
---

# Agent Initialization

If an applicable reference conflicts with this SKILL.md, follow the reference
because it is more specific. Within its scope, a method or benchmark recipe also
takes precedence over Penguin defaults; user instructions take precedence over
both. Read only applicable references, record overrides, and report any behavior
that Penguin's actual interfaces cannot support.

Turn a user requirement into a Target Agent's initial harness, or extend an
existing Agent within the requested scope. The current Agent acts as Builder.
Initialization creates the baseline; evaluation and optimization are separate.

## Companion supervision

For an RSI task, first follow [method selection](../agent-optimization/references/selection.md)
and reuse the user's choice for initialization and its source-record handoff.
Resolve a missing choice before creating companions or changing State.

Read and follow [Agent Supervision](../agent-supervision/SKILL.md) before work.
Without an assigned pair, act as the delegating Root and start a Supervised Agent
with its Supervisor companion. With a verified pair binding, execute this Skill;
pair each new task child separately. Join both reports at the parent. Confirmed
cheating permits at most three fresh retries with corrective user instructions;
continued cheating on attempt 4 receives a policy zero and reason under that
contract. This caller-owned recovery is separate from unstarted-launch repair.

## Before you start

| Recipe | Read when |
| --- | --- |
| [Penguin](references/penguin.md) | Always for Penguin layout, runtime, configuration, Skills and hooks; the default recipe |
| [ACE](references/ace.md) | Preparing the empty playbook and fixed reader for ACE |
| [AWM](references/awm.md) | Preparing the empty workflow index and fixed reader for AWM |
| [OPRO](references/opro.md) | Preparing the initial instruction and fixed reader for prompt optimization |
| [APE](references/ape.md) | Preparing the empty instruction slot and fixed reader for prompt induction |

Use Penguin when no method is requested. Add the selected method's initialization
reference; do not load every method or install other methods' artifacts. A method
with no special initialization may have an empty reference and inherit Penguin.
For an unknown requested method, use its supplied recipe or ask for the missing
instructions rather than substituting another method.

If the request only invokes this Skill without a requirement, ask what the Agent
should do. Otherwise derive the role from the supplied requirement and report
reasonable assumptions without asking the user to restate it.

## Inputs and scope

Resolve the destination Project, target identity, requirement, whether to create
or extend, and selected method. Use only the specified Target; reject traversal
or escaping paths. A new target ID must not already exist. Extending an existing
Agent does not authorize replacing unrelated settings or learned state.

Resolve a complete provider/model pair from the user's explicit pair or the
Builder Session's Environment; reject a half pair. Resolve thinking independently
from the user or Builder configuration. The Penguin reference defines storage and
defaults. Carry the resolved runtime explicitly into any requested evaluation;
do not silently select a different model.

## Build the initial harness

1. Inspect only the source configuration and capabilities needed for this request.
   Write concise role and domain instructions and install only relevant Skills,
   tools or hooks using the selected recipe. Review imported instructions before
   installing them and verify any executable hook with representative input.
2. Preserve unrelated existing configuration. Parse complete configuration files
   with duplicate-key rejection; replace fields rather than appending duplicates.
3. For an RSI Target, prepare the method's empty artifacts and fixed reader before
   baseline measurement. Keep Optimizer instructions and private evaluation
   materials out of the Target. Do not import another experiment's learned state
   into a baseline described as empty.
4. Validate the finished harness and hand it off while no worker is executing it.
   A repair after measurement is a changed baseline, not a learning gain. Follow
   the optimization snapshot/version contract before changing a measured Target.

## Validate and report

Check the expected identity, positive integer version and runtime; nonempty role
instructions; and parseable Skill metadata whose name matches its directory.
For hooks, check that each declared command stays inside its package and that
representative inputs produce the declared output with a successful exit. Check
the selected recipe's baseline artifacts and confirm no unrelated Agent changed.

Report the Target ID and path, created versus extended status, selected recipe,
assumptions, changed files and installed capabilities, resolved runtime and its
source, validation results, and when the changes become effective. Include each
hook's purpose and execution point. Report blockers explicitly; initialization
does not itself establish an evaluation score or optimization benefit.
