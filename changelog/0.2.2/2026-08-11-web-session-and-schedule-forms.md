# Web App: copyable Session id, schedule-form pickers, saved toast, {{SHELL}} placeholder

Four chat/settings tweaks (#245):

- **Copyable Session id.** The chat details card gains a Session id row under the model line; the id is a click-to-copy button (label flips to "Copied", optimistic so it works regardless of clipboard-permission context).
- **Schedule form selectors match the Project defaults dialog.** New-Session mode uses the same form-variant `ModelSelect` / `WorkspaceSelect` pickers instead of a native `<select>` plus a raw path input (leaving the project default selected still means "follow the default"); Bind-Session mode replaces the free-text Session-id input with a searchable dropdown fed by the agent's session list, matching on title or id.
- **Saved toast for Project new-chat defaults.** Saving the defaults block surfaces a "Saved" toast — the dialog stays open, so success was previously silent.
- **`{{SHELL}}` placeholder restored.** The Agent Prompt tab's placeholder list showed 12 entries while the default system prompt uses 13 — `{{SHELL}}` was missing, so rebuilding the Environment block from the click-to-insert list silently dropped the shell line. Added in prompt order, with a unit test deriving the expected tokens from core's real `DEFAULT_SYSTEM_PROMPT` so the list can't drift again.
