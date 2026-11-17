# Plugins can be linked from a local directory

- **Date:** 2026-11-15
- **Type:** feature
- **Scope:** `server`, `cli`, `web`

[中文版](2026-11-15-plugin-local-directory-link.zh.md)

`penguin plugin link <directory>` links a local plugin package directory into the server's plugin prefix instead of uploading a copy of it: the directory stays where it is, and the server loads the plugin in place. The link is npm's own — the directory is recorded as a `file:` dependency of the prefix and reified as a symlink, so npm keeps the link and its record in step through later installs, and `penguin plugin remove` takes the link out the way it removes any package while leaving the author's directory untouched.

## Details

- The directory is vetted before anything is sent: the CLI reads it with the plugin library's own reader (the same gate a directory install passes), and the server refuses a directory that is not a package or carries no plugin surface. A name already installed in the prefix refuses until `--overwrite` replaces it with the link.
- The loader resolves a linked package's name to the author's directory through the symlink — the same lookup path an installed package takes — and reads the declaration, the contributions and the version from the directory's files. An edit to the directory applies on the next load; the Plugins page shows the new version and description on the next refresh. If the directory is deleted or renamed, the page shows the row's fault from that read rather than passing the plugin as installed.
- Linked plugins appear on the Plugins page beside the installed ones, on the same cards, with a **link** tag that names the directory in its hint. A linked package has no content hash pinned to it: the same directory is different content at different times, so a pinned version still calls for an install.
