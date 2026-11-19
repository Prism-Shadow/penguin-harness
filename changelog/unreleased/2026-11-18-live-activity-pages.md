# Choose how conversations show reasoning and tools

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `web`, `ui`, `server`
- **PR:** [#1607](https://github.com/Prism-Shadow/penguin-harness/pull/1607)

[中文版](2026-11-18-live-activity-pages.zh.md)

**Settings → Appearance → Reasoning display** offers three ways for every theme to show a conversation's work. The account saves the choice, and it applies to conversations you reopen.

- **Standard**, the default, is the work group as it was: while the run is active its steps are listed closed, each tool row keeping its name, one-line description or file path, duration and subagent row. Select a step to read its reasoning, arguments or output.
- **Expanded** opens every step as it arrives. You can fold a step or the whole group. A value that a saved conversation carries folded shows its preview with **Load the full text**; it is fetched only when you press that or open the step yourself.
- **Compact** follows the latest step in one line: the step's name and description or path, arrows to review earlier steps, and the run's total time at the end of the line. **Latest step**, to the right of the next-step arrow, resumes following. To go to a step, type its number over the one in **Step N** and press Enter; a number past either end goes to that end, and Esc keeps the current step. Opening the line lists every step of the group with the same rows as Standard, each tool keeping its description or file path; select one to read its details. A finished run has a final page for its outcome when the record shows it. Your place stays put while new output arrives and when the run finishes. A step waiting for your approval opens the line by itself, so **Allow** and **Deny** show at once; the hourglass visits each one when several are waiting.

Searching the conversation temporarily reveals every loaded step, and closing the search restores the page and the folds.
