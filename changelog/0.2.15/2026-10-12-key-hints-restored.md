# Hover hints that say what the screen does not show open again

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `ui`, `web`
- **PR:** [#1051](https://github.com/Prism-Shadow/penguin-harness/pull/1051)

[中文版](2026-10-12-key-hints-restored.zh.md)

The tooltip rule opens a hint only on an element with no words of its own or with its words cut off. Hints that carried something the screen does not show — what a click discards, a shortcut, the full path behind a folder's name, why a control is disabled — had stopped opening on controls with visible text, and an avatar's initial or a letter used as an icon counted as visible words, silencing the hint that names it. The rule now leaves such text out, and a hint that adds to visible text is marked and opens over it.

## Details

- `hintAllowedFor` no longer counts text inside an SVG or inside `aria-hidden` as the element's words, so the hints naming an avatar open again (a Session row's Agent, the collapsed rail's account, the company rail's desks, a Benchmark's tested Agents). The find bar's `Aa`, the Session row's approval count, a toolbar trigger's corner count and a chip's × became `aria-hidden` marks; the approval count is named in hidden text instead.
- A `data-tooltip` marked `data-tooltip-extra` opens over fully visible text; `<Tooltip extra>`, `tooltipExtra` on `NavRow` and `Chip`, and `titleExtra` on `FormPickerTrigger` set the same mark. A `Badge`'s tooltip and a `BetaBadge`'s title are always marked; `Breadcrumbs` marks its path while leading folders are folded into "…"; `DockTabs`, `Legend` and `FileTree` mark a hint that says more than the label.
- Marked, by kind of hint:
  - What a click does: Clear exited and Remove in the background process list, Send to background, a plugin's Export and Quick start, memory Export and Import, the protocol and vision Detect buttons, Fast mode, Fill the app, Steer and Queue, the Workspace finder's Choose and no-folder buttons, the composer's handoff, model-switch, skill and goal chips, a messaging connection's enable switch.
  - Why a control is disabled or a state is wrong: the Agent API panel's Run, a speed test or MCP test failure, an invalid organization, schedule or employee, a blocked ticket, a broken workflow, a file changed on disk, a locked plugin setting, an Agent that lives on another machine.
  - Shortcuts: New chat, the find bar's scope switch, the finder's path, the model picker's group tabs.
  - Full values: a Workspace's path behind its folder name, a memory group's Workspace, a subagent's Session id, a model id in the model picker, a data path capsule, a reference chip's path, a Trace file's date and size, exact times behind relative ones, the first time of a folded error.
  - Meanings: plugin tags and a plugin's status, a model's discount terms, the permission presets, a channel's hop chip, the context panel's ranking heading, an overdue due date, a calendar event's employee and outcome, the new-version badge, the draft page's example descriptions.
