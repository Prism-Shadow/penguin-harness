# Model picker opens as a dialog

- **Date:** 2026-09-24
- **Type:** feature
- **Scope:** `web`

[中文版](2026-09-24-model-picker-modal.zh.md)

The model picker is now a dialog. It opens on the current model and makes a model in any group a few keystrokes away.

## Layout

- A search field sits on top. Below it, a rail on the left lists the provider groups (logo, name, model count) in the order saved on the models page, and the right side lists the models of the active group.
- Typing in the search field replaces the right side with matches from every group, grouped by provider with the best matches first. Clearing the search returns to the group view.
- Each row shows the display name, the upstream id when it differs, and the same markers as before: the Free badge, the no-key mark, the Project default and the current-model check.
- At phone width the dialog fills the screen, and the rail becomes a strip of group chips that scrolls sideways above the list.

## Focus and keyboard

- The dialog opens with the current model's group active and the current model highlighted and scrolled into view. With nothing chosen yet, it opens on the first group that has a configured key.
- ↑/↓ move through the list or the rail, ←/→ or Tab switch between them, ⌥1–9 (Alt+1–9 outside macOS) jump to a group — not ⌘/Ctrl, which the browser keeps for switching tabs — Enter chooses and Esc closes. Typing always goes to the search field.

## Models without a key

- As before, models without a configured key are hidden unless they are selected or the Project default. A footer toggle, "Show models without a key (N)", lists them along with their groups and can turn them off again. When no model has a key, every model is listed.

## Where it opens

- The composer's model button, the model fields in Project settings, the schedule form, the company dialogs and the benchmark dialog open the dialog. Their triggers look the same, and each host receives the same selection as before.
- The in-session `/model` command opens the same dialog. A pick is still staged as a chip and applied when the message is sent.
