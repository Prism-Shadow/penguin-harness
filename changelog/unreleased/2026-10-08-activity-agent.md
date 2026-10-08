# A builtin Activity Agent, and module runs read the WAF skills

- **Date:** 2026-10-08
- **Type:** feat
- **Scope:** `core`, `server`, `web`, `activities`, `plugins`

## Module runs read the WAF skills

A module run now stages the WAF authoring skills it needs into its workspace under
`skills/`, each with its reference files, plus `skills/README.md` listing them in reading
order. Its prompt tells the agent to read them before implementing. Until now the module run
was given none of them; only the assessment run staged its skill.

The list is Loom's: the framework overview, then the behaviour skill (the state machine, or
the assessment patterns for an assessed activity), then the shared pattern skills. A book
also gets `waf-book-generation`. Where a skill and the run's message disagree, the message
wins. The skills sit beside `module/`, so they never ship with the module.

A run whose skills are not installed fails with `skills_missing` before the Session starts.

## The Activity Agent

Every Project now has a third builtin Agent, the **Activity Agent** (`activity_agent`). It
cannot be deleted. A Project created before this change gets it the next time its agents are
listed.

It comes with the `waf-authoring` plugin installed. That plugin stays out of the General
Agent's preinstalled set. Its AGENTS.md holds the rules every stage shares: follow the run's
message, treat the WAF checkout as read-only, report missing media and capabilities instead
of faking them, never publish, deploy or delegate, and finish only after writing the result
file.

The Activities agent picker now defaults to the Activity Agent instead of the agent in use.
Picking another agent or a coding agent works as before. Speech, sound and images still run
on the Media Agent. A coding agent's Session is still owned by the agent in use, so its
Vault is unchanged.
