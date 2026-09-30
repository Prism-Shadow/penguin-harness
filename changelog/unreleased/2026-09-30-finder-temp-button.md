# Workspace finder offers the temporary workspace as a button with its path

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#907](https://github.com/Prism-Shadow/penguin-harness/pull/907)

[中文版](2026-09-30-finder-temp-button.zh.md)

The Workspace finder's bottom-left became a button, **Start in a temporary workspace**. It replaced the underlined link and the hint "leave empty for a temporary workspace; if set, it must be an existing directory on the server".

## Details

- The button appears wherever the picker offers no folder (the chat draft, Project settings → Defaults, the schedule form), whether or not a folder is chosen. While none is, it carries a check.
- After its label it shows, muted, where the temporary Workspace would be created: `…/agents/<agent>/workspaces/tmp-…`. The full path is in the tooltip. The path is derived from the `stateDir` of the Agent's config. When the Agent is not known (Defaults with no default Agent) or another machine is being browsed, the button shows its label alone and the tooltip states the rule.
- The hint also left the picker's tooltip and the Workspace fields in Project settings → Defaults and the schedule form. The company workspace field dropped its own version of it.
- The company workspace picker's button reads **Use the organization's own directory**, and the Agent create dialog's reads **Don't import from a directory**. The sidebar's new-workspace finder has no such button.
- On a narrow screen the path truncates first, then the label, and Cancel and Choose keep their width.
