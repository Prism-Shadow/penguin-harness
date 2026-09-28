# Workspace picker opens a Finder-style modal

- **Date:** 2026-09-24
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#858](https://github.com/Prism-Shadow/penguin-harness/pull/858)

[中文版](2026-09-24-workspace-finder-modal.zh.md)

Every Workspace picker (the chat draft's pill, the form fields in Project settings, schedules, the company dialogs and the Agent create dialog, and the sidebar's new-workspace button) now opens a Finder-style modal instead of a dropdown. The triggers look the same, and hosts still receive the chosen folder and its machine.

## The finder

- A sidebar lists Favorites (home, plus Desktop, Documents and Downloads where they exist on that machine, and the drive roots on Windows), Recent (Workspaces of this Project's newest Sessions) and, where the picker offers machines, Machines; choosing a machine browses from its home.
- The current folder is a list with folders first, name and modification time; files are shown dimmed and cannot be chosen. Hidden entries stay hidden.
- The toolbar has back and forward, a clickable breadcrumb path and a filter box. **Go to folder** (⌘⇧G on macOS, Ctrl+Shift+G elsewhere) replaces the editable path row; a path that does not exist still shows a toast and keeps the current folder.
- **Choose** takes the selected folder, or the current one when nothing is selected. The temporary-workspace link stays in the footer where the picker offered it.
- Keyboard: ↑/↓ move, Enter or ⌘↓ opens, ⌘↑ goes to the parent, ⌘[ and ⌘] go back and forward, ⌘Enter chooses, typing a name prefix selects, Esc cancels (Ctrl in place of ⌘ off macOS). The finder opens with the current Workspace selected in its parent folder.
- On a phone the modal fills the screen and the sidebar sits behind a toggle.

## Unreadable folders

- The directory API answers a folder the server may not read with `403 dir_permission_denied` instead of an empty listing, for this machine and for machines browsed over ssh.
- The finder says so in the folder pane. When the server runs on macOS, it points to System Settings → Privacy & Security → Files and Folders.
- Directory listings now include files, each entry's kind and modification time, the server's platform, and the drive roots on Windows.
