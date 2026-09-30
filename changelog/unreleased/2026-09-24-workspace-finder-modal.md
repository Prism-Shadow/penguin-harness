# Workspace picker opens a file-browser modal

- **Date:** 2026-09-24
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#858](https://github.com/Prism-Shadow/penguin-harness/pull/858)

[中文版](2026-09-24-workspace-finder-modal.zh.md)

Every Workspace picker (the chat draft's pill, the form fields in Project settings, schedules, the company dialogs and the Agent create dialog, and the sidebar's new-workspace button) now opens a file-browser modal instead of a dropdown. It follows the habits of the platform file managers, Windows Explorer's in particular. The triggers look the same, and hosts still receive the chosen folder and its machine.

## The finder

- The sidebar starts with **Quick access**: home plus the standard folders of the browsed machine's own platform, where they exist there. That is Desktop, Downloads, Documents and Pictures on Windows; Desktop, Documents and Downloads on macOS; and Desktop, Documents, Downloads and Pictures on Linux. Windows lists its drives under **This PC**. **Recent** (Workspaces of this Project's newest Sessions) and, where the picker offers machines, **Machines** follow; choosing a machine browses from its home.
- Quick access is editable. The **+** beside its heading adds the folder on screen, the context menu adds any folder, and a hover **×** or the context menu removes an entry, default ones included. The changes are kept per machine in this browser.
- The toolbar holds back, forward, up and refresh as plain icons, then an **address bar** that looks like a text field. Clicking a path segment opens that folder; clicking elsewhere in the bar (or ⌘⇧G on macOS, Ctrl+Shift+G elsewhere) turns it into an editable path. Enter goes there and Esc puts the segments back; a path that does not exist still shows a toast and keeps the current folder. A filter box sits at the right.
- The current folder is a list with folders first, name and modification time. Each folder row ends in an enter arrow, as well as opening on double-click or Enter. Files are shown dimmed and cannot be chosen, and hidden entries stay hidden.
- **Right-click** (press-and-hold on touch, Shift+F10 on the keyboard) opens a menu. A folder gets Open, Choose this folder, Add to / Remove from Quick access, and Copy path; a file gets Copy path. The list's empty space acts on the folder on screen and adds Refresh. Sidebar entries have the same menu.
- **Choose** takes the selected folder, or the current one when nothing is selected. The temporary-workspace link stays in the footer where the picker offered it.
- Keyboard: ↑/↓ move, Enter or ⌘↓ opens, ⌘↑ goes to the parent, ⌘[ and ⌘] go back and forward, ⌘Enter chooses, typing a name prefix selects, Esc cancels (Ctrl in place of ⌘ off macOS). The finder opens with the current Workspace selected in its parent folder.
- On a phone the modal fills the screen and the sidebar sits behind a toggle.

## Unreadable folders

- The directory API answers a folder the server may not read with `403 dir_permission_denied` instead of an empty listing, for this machine and for machines browsed over ssh.
- The finder says so in the folder pane. When the server runs on macOS, it points to System Settings → Privacy & Security → Files and Folders.
- Directory listings now include files, each entry's kind and modification time, the server's platform, and the drive roots on Windows.
