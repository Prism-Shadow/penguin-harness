# Skills linked in from a skill manager are loaded

- **Date:** 2026-10-01
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `docs`

[中文版](2026-10-01-linked-skills.zh.md)

A Skill or hook package under `agent_state/skills/` or `hooks/` may be a symbolic link to a
directory elsewhere — how skill managers keep one copy of each Skill and link it into every tool,
so an edit reaches all of them. Such a link used to be skipped; it is now listed, loaded and
counted like a copied Skill.

- Installing or updating over a linked Skill is refused with `409 skill_linked` (update it where it
  lives; replacing it would turn the link into a private copy).
- Uninstalling a linked Skill removes only the link, never the shared copy.
- A link whose target is gone is ignored.
