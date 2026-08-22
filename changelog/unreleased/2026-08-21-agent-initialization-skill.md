# `agent-creation` renamed to `agent-initialization`

- **Date:** 2026-08-21
- **Type:** change
- **Scope:** `skills`, `web`, `docs`
- **Breaking:** the library Skill `agent-creation` no longer exists under that name

[中文版](2026-08-21-agent-initialization-skill.zh.md)

The Agent Tuning group's `agent-creation` Skill is now **`agent-initialization`**. The name says what it
does: it initializes an Agent's settings — AGENTS.md, identity metadata, and the Skills that Agent needs —
rather than creating an Agent, which the product does elsewhere.

The Skill's own copy follows the name (`# Agent Initialization`, a rewritten description and both short
descriptions), and its `version` moves to 8. Behaviour is unchanged: same steps, same output, same files
written.

Every live reference moves with it — the group registry, the Skills library table in the docs, the draft
screen's example task that pins it, the SDK Skill's cross-reference, the READMEs and the SDK example.
Published blog posts and the frozen changelog entries of released versions keep the old name: they record
what was true when they were written.

## 兼容性

An Agent that already installed `agent-creation` keeps its copy at `agent_state/skills/agent-creation/`.
That copy still works — it is a self-contained directory — but it no longer corresponds to any library
Skill, so it will never be updated again, and the library will offer `agent-initialization` alongside it as
uninstalled. **Installing the new one leaves both on disk, doing the same job under two names.**

There is no automatic migration, by decision. To move over: install `agent-initialization` from the Skill
library, then delete `agent-creation` from the Agent's Skills tab. Anything that pins the Skill by name —
a prompt saying "use the agent-creation skill", a saved shortcut, an `AGENTS.md` that names it — needs the
new name; a stale pin resolves to nothing rather than failing loudly.
