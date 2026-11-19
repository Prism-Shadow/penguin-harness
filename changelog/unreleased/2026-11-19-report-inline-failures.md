# Inline failures in dialogs, forms and pages offer "[Report]"

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`, `ui`

[中文版](2026-11-19-report-inline-failures.zh.md)

An error said inline, in a dialog, a form, a panel or in place of a page, now offers "[Report]" after its words when it is a failure, the same rule the toasts follow since [2026-11-19-report-every-failure](2026-11-19-report-every-failure.md) (penguin-harness-design [#476](https://github.com/Prism-Shadow/penguin-harness-design/pull/476)). A refusal reads exactly as before, with no entry: a wrong password, a name taken, no permission, something that is not there, a field the server rejected. The words on screen do not change.

## Details

- Company mode: the overview, org chart, tickets, calendar, finance and handbook pages when they cannot load or refresh; a channel's details and messages; a ticket; the sidebar's channel and desk lists; the create-organization, organization settings and delete confirmations, the model field; the channel and employee dialogs.
- Agents: the settings page and its memory, plugins, vault, schedules and API tabs; API key creation and the concurrency and conversation settings; creating an Agent (its plugin library, a directory's Skills and the create itself); adding a vault entry; saving an MCP server; a zip import; deleting an Agent.
- Models: the list, the Add group dialog (protocol detection, the endpoint's model list, the import), the OAuth dialog and the key authorization dialog. A flow that ended in a refusal (an authorization that expired, was used or was rejected) reads plainly; one that failed (the provider unreachable, no usable key, a key not saved) offers the entry.
- Projects and users: creating and renaming a Project, its members, chat defaults and command policy; the users list, adding a user, resetting a password and deleting a user.
- Settings: the Agent API, Chrome extension and company mode switches, the archived conversations list and the profile.
- The Evaluation Center and schedules: creating and importing a Benchmark, the Benchmark lists and a Benchmark's cases; the scheduled tasks list and the schedule form.
- Plugins: an npm, link or zip install that failed in the import dialog, a plugin's MCP set-up, and the plugin library that could not be read.
- Sign-in and account: the login form and the change-password dialog.
- The built-in browser's import dialog and pairing code, renaming a conversation, making a folder in the folder finder.
- The chat: the context panel's composition, a memory's content and the memory list, and the draft's Agent picker when a machine's Agents could not be listed.
- The recovery panel's harness history: the history, a version's changes and its module tree, and a rollback that failed or did not finish in time.
- `ActivityGroup` shows `actions` on a head that expands too, at the foot of the open body after the detail in full, so a failed activity that keeps its steps still offers "[Report]".
- `PickerList`'s empty text and the company pages' error line take a node.
