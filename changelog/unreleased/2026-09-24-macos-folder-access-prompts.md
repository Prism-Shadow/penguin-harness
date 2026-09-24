# macOS asks before an agent reads your Desktop, Documents or Downloads

- **Date:** 2026-09-24
- **Type:** fix
- **Scope:** `desktop`

[中文版](2026-09-24-macos-folder-access-prompts.zh.md)

On macOS, a Workspace chosen under Downloads (or Desktop, Documents, an external or network volume)
looked empty to every agent, and no permission prompt ever appeared. macOS only asks on behalf of an
app that states why it needs such a folder, and the desktop app stated nothing, so every read was
refused without a word.

The app now carries a purpose string for each of those locations. The first time an agent or the
Workspace browser reaches into one, macOS asks once; the answer covers the app's server and every
agent shell it starts, and can be changed later under System Settings → Privacy & Security → Files and
Folders.
