# `penguin agent export` and `penguin agent import` move an Agent as a zip

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `cli`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[中文版](2026-11-04-agent-zip-cli.zh.md)

The CLI gained the two halves of the Agent zip: `penguin agent export <agent-id>` writes an Agent to the zip the Agents page's export dialog produces, and `penguin agent import <path>` creates an Agent from such a zip, from an old `.tar.gz` Agent State package, or from a folder laid out as the zip, which is how the `agent-porting` Skill brings in an Agent from another coding tool.

## Details

- `export` chooses the parts with the dialog's defaults: `--no-skills`, `--no-hooks`, `--no-memory`, `--no-workbenches` and `--no-workbench-data` leave a part out, `--schedules` adds the schedules, and `--traces none|last:<N>|<from>..<to>` selects Sessions. Every part is sent explicitly in the `GET …/agents/:a/archive` query, and a malformed `--traces` fails before any request. The preview is asked first with the same query: what the export leaves out (a part whose folder is a link, Sessions with a file too large for an import) goes to stderr, and a selection the server would refuse stops there with exit 1 and no download. The zip streams to disk through a temporary file, so a broken download leaves nothing behind; `--out` takes a file or a directory, and only the last segment of the server's file name is used. `--json` prints `{agentId, projectId, file, bytes, notes}`.
- `import` uploads the file as the raw request body (`application/octet-stream`) to `POST …/agents/import`, with `--agent-id` and `--overwrite` as its query. A folder needs `manifest.json` at its root; the CLI zips it in memory with its manifest at the zip root, leaving `.git`, links and special files out, so no `zip` program is needed. A file or zipped folder larger than 100 MiB is refused before anything is sent.
- The text report names the Agent created or replaced and its Agent State version, the backup an overwrite wrote, what was imported, the Sessions left out with their reasons (and the server's detail when it gives one), the vault keys and blanked MCP values to fill in, and the server's notes: a note whose code the CLI knows is worded in the CLI's language, any other prints the server's sentence. A taken id fails with the server's `agent_exists` and a line on `--agent-id` and `--overwrite`. `--json` prints the response.
- `ServerClient` gained `download`, a binary GET streamed to disk under the name from `Content-Disposition`, and `upload`, a raw body sent with `duplex: "half"`; a request it retries (a refreshed token, a stored sign-in) sends its body again.
- The `.tar.gz` packages are accepted for compatibility; see [backward compatibility](2026-11-04-backward-compatibility.md).
- The CLI reference documents both commands.
