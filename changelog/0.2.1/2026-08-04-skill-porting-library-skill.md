# Skills: skill-porting — install skills from any ecosystem

New library skill `skill-porting` (agent-tuning group) teaching an agent to bring skills in from the outside world and land them correctly in `agent_state/skills/<name>/`. Its schema tables were verified by directly fetching each source on 2026-08-04 — the skill says so and treats the live JSON as authoritative:

- **Claude Code plugin marketplaces** (`anthropics/claude-plugins-official`, 278 plugins): the marketplace.json shape, all four `source` forms (relative path, sha-pinned `url`, `git-subdir`, `github`) and the five places a plugin can keep skills.
- **Codex plugins** (`openai/plugins`, 180 plugins): the `.agents/plugins/marketplace.json` entry shape with its `policy` block and `.codex-plugin/plugin.json` layout.
- **`npx skills add` / skills.sh** (`vercel-labs/skills`): spec forms, per-agent install destinations, and the in-repo discovery order — resolved by fetching from the source repo, never by blindly running the installer.
- Plain **GitHub repos/subdirectories** (sparse checkout / tarball / raw fetch variants) and **local folders**, plus the agentskills.io SKILL.md convention.

Each flow ends in the same normalization: adapt frontmatter to penguin's fields (`short_description`, `short_description_zh`, integer `version`, `updated`), port or drop commands/agents/hooks penguin has no runtime for (honestly — the skill forbids pretending a dropped capability survived), and verify the install. Safety first is mandatory: read every file before installing, refuse content that exfiltrates, phones home, or overrides safety rules, prefer pinned revisions.

The web Import dialog's generated prompt points agents at this skill when it is installed. Docs skill tables (en/zh) gained the one row the library-sync test requires.
