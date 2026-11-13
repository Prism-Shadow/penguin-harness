# Import workbench: through a chat with the agent, or from a zip

- **Date:** 2026-11-10
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#1525](https://github.com/Prism-Shadow/penguin-harness/pull/1525)

[中文版](2026-11-10-workbench-import-dialog.zh.md)

The **Workbench** item of the agent settings Plugins tab's **Import** menu opens **Import workbench**, which became the dialog the Skill and hook package imports use: the recommended chat import on top, the zip upload below. The menu item now says, like the other two, that it uploads a zip or has the agent import it in a chat.

## Details

- **Recommended: import it by chatting with the agent.** **Workbench source** takes a web page, a GitHub repository or directory, a local path, an install command from another ecosystem, or a reference or description. The prompt preview leads with a sentence for that kind of source and ends with a fixed tail: read every file before installing; because a workbench's pages run inside the app and its server handlers run on this server, review it for anything that sends data out, runs commands it does not need, or reaches outside its own directory, and stop instead of installing if anything looks wrong; then lay it out as the `penguin-plugin` Skill describes, put it in `agent_state/workbenches/<id>/` of this agent, named by Project and agent id, and reload it.
- **Copy prompt** and **Open a new chat** stay disabled until a source is typed. The chat opens with this agent, on the machine the agent lives on. Closing the dialog with a source typed asks first.
- **Upload a workbench zip** kept its behaviour: a taken id (409 `workbench_exists`) asks before overwriting, and the workbench's data (`state.json`) stays.
- The Skill, hook package and workbench imports moved onto one shared dialog, `chat-or-zip-import-dialog.tsx`. Each hands it its title and words, its prompt builder, its upload call with the code of the 409 that asks before overwriting, and the file type it accepts. The Skill and hook package dialogs kept their copy and behaviour.
- The agents docs page's **Workbenches** section describes both ways, and the **Plugins tab** list says all three kinds import from a zip or through a chat.
