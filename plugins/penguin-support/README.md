# PenguinHarness Support

The default Project installs this plugin on its PenguinHarness Support agent. You can also install it on another agent from the plugin library. Open a conversation with that agent and choose the Support tab.

The workbench shows a centered question list. New question and conversation details open in dialogs; follow-ups stay on the same ticket. The `penguin-support` Skill reads the official docs and repository before answering. The selected Project model handles each question.

`workbenches/support/` contains plain HTML, CSS, JavaScript and a TypeScript backend. Installing or updating replaces its code while preserving `state.json` and workbench history. Uninstalling the workbench removes its records, just like removing a workbench from the agent.
