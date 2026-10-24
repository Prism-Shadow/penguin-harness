# A skill for contributing design RFCs

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `skills`

[中文版](2026-10-19-penguin-rfc-skill.zh.md)

Added the `penguin-rfc` skill: the standard path for an agent writing, reviewing or revising a design RFC under `rfcs/` — deciding when a change needs one, drafting from the template, picking the number, keeping the RFC and its implementation in separate pull requests, answering review, and revising a landed RFC with a raised rev.

## Details

- The skill lives at `.agents/skills/penguin-rfc/SKILL.md`, beside the repository's other development skills; it is not part of the shipped plugin library.
- It summarizes the rules stated in `rfcs/README.md`, the RFC section of `.github/CONTRIBUTING.md` and `rfcs/TEMPLATE.md`, and names each Check RFCs failure together with its fix.
- It assumes the RFC surface lands first: the paths it points at (`rfcs/`, the template, the Check RFCs workflow) exist on the `rfcs` change's branch today.
