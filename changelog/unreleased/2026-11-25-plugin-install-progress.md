# Plugin installs show one staged progress bar

- **Date:** 2026-11-25
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`
- **PR:** [#1867](https://github.com/Prism-Shadow/penguin-harness/pull/1867)

[中文版](2026-11-25-plugin-install-progress.zh.md)

Installing a plugin from the plugin market now reads like installing an app on a phone: the plugin's icon and name, one progress bar cut into the stages this install goes through, one sentence saying what is happening, and a clear finished state.

## Install sheet

- The bar has one segment per stage that will actually happen: looking the plugin up, downloading and installing it, starting it, and choosing an agent. Enabling a plugin the server already carries, or installing on another machine, has only the start stage; a plugin with nothing for agents has no agent stage.
- Finished stages are full. The current stage fills by the download's real amount when the server reports one, with the percent beside the sentence, and otherwise shows a small pulsing mark. The bar never moves back within one attempt and is full only when everything is done.
- While the install runs, the icon dims under a turning ring, as an installing app does in the App Center. The sheet says that an install cannot be stopped and carries on in the background, and its one button is **Continue in background**.
- After a server install, the sheet moves on to choosing an agent, says that no agent has the plugin until it is added, and offers **Choose later**. Once an agent is added, it says the plugin is ready and who has it, and offers to open its app or its quick start.
- A failed install stops the bar at the stage it reached, says the plugin could not be installed with the server's reason, and offers **Try again**, the plugin sources and a file import. A failure offers the problem report.
- A member who cannot install sees a short explanation and **Ask an admin to install** instead of an install step.
- The stage sentences were rewritten in everyday words, in Chinese and English.

## Market card and package update

- The market card's install action shows the same bar under its one-line words while the install runs.
- The package update confirmation shows the same bar and sentence.

## Shared UI and gallery

- Added `StagedProgress` to the UI package, and an optional progress slot on a cover card's bar action.
- The gallery's Loading board shows the staged bar in each state. Its demo market installs two packages through the whole stream, one of which fails part-way through its download, and a frame can sign in as a member with `as=member`.
