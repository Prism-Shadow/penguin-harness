# Choose how conversations show reasoning and tools

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#1607](https://github.com/Prism-Shadow/penguin-harness/pull/1607)

[中文版](2026-11-18-live-activity-pages.zh.md)

In **Settings → Appearance → Reasoning display**, choose how every theme shows a conversation’s work. **Standard** lists steps by name and duration while the run is active. Select a step to read its reasoning, tool arguments or results. **Expanded** opens those details for you. You can fold individual steps in either view.

**Compact** follows the latest step in one line. Use the arrows to review earlier steps. To resume following, select **Latest step**, to the right of the next-step arrow. The line shows the step number, total run time, and the tool description or file path when available. Open it on any page to see the whole group. Select a row to read its details. A completed run has a final page for its outcome. Your place stays put while new output arrives, including when the run finishes.

Your account saves this choice. It also applies to conversations you reopen. Pending approvals and retries have a direct shortcut. Searching temporarily reveals all loaded steps and restores the page and folds when you close the search.
