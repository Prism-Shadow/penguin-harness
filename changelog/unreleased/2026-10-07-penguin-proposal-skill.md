# One proposal skill, and refused writes point employees to it

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `agent-company-proposals`, `company-proposals`, `server`, `docs`, `landing`

[中文版](2026-10-07-penguin-proposal-skill.zh.md)

`agent-company-proposals` (2026.10.07.1) shipped one skill, `penguin-proposal`, in place of `proposal-author`, `proposal-implementer` and `proposal-tester`, and an employee whose proposal or roadmap write was refused or failed was told to load it.

## Details

- `penguin-proposal` had a section per role: author, implementer, tester, roadmap member and roadmap moderator. The roadmap sections gave ready-to-run `penguin org action run` commands and their traps — `roadmap.draft` replaces every item, a new brief carries no `proposal` field, a `roadmap` item derives a child roadmap, an existing proposal is linked rather than approved, reopen before changing items and establish after, a forwarded task is not authorization — and what `not_established`, `item_not_found` and `items[n].proposal must be a proposal number` mean.
- company-proposals' install of the skills plugin on an author or implementer also removed the three retired skills from that employee. `AgentLifecycle` gained `removeSkill`.
- A proposal or roadmap Action refused or failed for an employee answered with one more line: load `penguin-proposal` first if it is not loaded, and where its `SKILL.md` is. A person's answer and the recorded run were unchanged.
- The skills page of the docs, the landing page and the plugin READMEs named the new skill.

## Compatibility

- An employee that carried the three old skills kept them until company-proposals next installed the skills plugin on it (on writing or building a proposal). The removal by name is to be dropped once employees hired before this change have been through such an install.
