# Skill library: update reminder, borderless groups, accent icons

The skill library reminds you when an Agent's installed copy of a skill is older than the
library's version — an accent rotate button on the card updates every outdated Agent in one
click, and the manage-installs dialog marks outdated rows with an Update button. Group
sections lose their border, and card icons sit on a theme-accent background.

## Details

- The installed-skills snapshot now tracks each installed copy's `version` (the read API
  already returns it — the installed SKILL.md frontmatter is the source). A pure
  `outdatedAgentIds` helper (unit-tested) flags Agents whose copy is strictly older than
  the library's; not-installed Agents and locally *newer* copies never trigger it.
- Card footer: when any Agent is outdated, an accent rotate button appears
  ("有新版本：更新 N 个 Agent 的安装" / "Update available"); clicking reinstalls the current
  library copy on every outdated Agent (install-again-is-update semantics) with one batch
  success toast; partial failures keep the succeeded Agents and toast the first error.
- Manage-installs dialog: outdated rows show an accent "更新"/"Update" button next to
  "已安装"/"Installed", updating just that Agent.
- Styling: group sections are borderless (header background alone carries the grouping);
  card icons use the theme accent (`--accent-bg`/`--accent-fg`, following the theme-color
  setting) instead of the gray bordered tile.
