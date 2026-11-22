# Storage cleanup keeps a Workspace a Session reaches through a folder link

- **Date:** 2026-11-22
- **Type:** fix
- **Scope:** `plugins`, `server`

[中文版](2026-11-22-fix-storage-workspace-refs.zh.md)

Settings › Storage no longer offers to clean up a temporary Workspace that a Session still uses when the Session's recorded path reaches it through a symbolic link or a Windows directory junction, such as the `<data root>/<project>` link kept until 1.0. On Windows, a path that differs only in letter case also counts as in use. Removing such a Workspace is skipped as in use, as it already was for the same path written plainly.
