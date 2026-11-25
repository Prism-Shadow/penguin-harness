# Replace the new chat's examples with Build New App, Optimize App and Publish App

- **Date:** 2026-11-25
- **Type:** feature
- **Scope:** `web`, `ui-gallery`
- **PR:** [#1860](https://github.com/Prism-Shadow/penguin-harness/pull/1860)

[中文版](2026-11-25-home-shortcuts-simplify.zh.md)

Replaced the new chat page's shuffled example prompts with three fixed shortcuts, centred under the composer and drawn as pills. Build New App fills a prompt for a new workbench app published to the App Center. Optimize App and Publish App each open a searchable list of the Project's apps on the draft's machine, system apps excluded, and fill a prompt naming the chosen one: Optimize App asks the agent to improve it, and Publish App asks it to open pull requests adding the app to [PenguinHarness Apps](https://github.com/Prism-Shadow/penguin-harness-apps) and registering it in the [plugin index](https://github.com/Prism-Shadow/penguin-harness-plugins). The Publish list leaves out apps a library plugin installed. While a list loads, or when it cannot be read, the menu says so and offers a retry. Saved shortcuts follow the three, and Shuffle suggestions and More examples were removed.
