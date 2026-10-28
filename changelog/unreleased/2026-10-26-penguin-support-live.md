# PenguinHarness Support shows the answer as it is written

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `plugins`
- **PR:** [#1352](https://github.com/Prism-Shadow/penguin-harness/pull/1352)

[中文版](2026-10-26-penguin-support-live.zh.md)

The Support workbench of the `penguin-support` plugin began following a question's conversation live instead of only polling for its result. Its version moved to `2026.10.26.1`, so installed copies show the plugin update badge; the built-in copy on the default Project is not updated automatically.

## Details

- The handler subscribes to the Session of every running question (`host.subscribe`), when the workbench loads and before each question, follow-up or retry starts. When the main task ends it waits for the Session to read idle, saves the answer or the failure, and unsubscribes, so an answer is saved without the page open. `GET /tickets` still reconciles running questions, which covers a task that ended while the server restarted or the workbench reloaded. On a server whose workbench host has no `subscribe` (0.2.17 and earlier), the handler skips subscribing and `GET /tickets` saves every answer, as before.
- While a researching question's dialog is open, the page imports `../sdk/workbench.js` and follows the Session with `followSession`. It shows the current Request's text as a draft under "Answer in progress", and an activity line in plain words taken from the tool being called ("Reading the documentation and code…", "Searching the documentation and code…"). Records from subagents (with `origin`) are ignored. One reader serves the open dialog and closes when the dialog closes or the page is hidden.
- When the task ends the page reloads the list at once, and the list is polled every 5 seconds instead of every 2.5.
- A Stop button stops the running question through `abortSession`, after an inline confirmation. When the main Session's `abort` record carries a user-interruption code, the handler saves the question with `stopped: true`, and the page then shows "This question was stopped before the answer was ready. Click Retry to ask again." instead of the server's error text. `stopped` is a new optional ticket field; state saved before it loads unchanged.
- Statuses in the list and the dialog are `wb-badge` pills with a tone: Open is attention, Researching and Answered success, Resolved done, Needs attention danger. The dialog uses the theme's backdrop and modal shadow tokens.
- When the SDK cannot be loaded (an older server, or a broken build), the page goes back to polling every 2.5 seconds, and the dialog shows the waiting time without a draft or a Stop button.
