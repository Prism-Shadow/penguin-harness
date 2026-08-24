# Every Harness state file is replaced atomically

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `core`, `server`, `cli`, `desktop`

[中文版](2026-08-23-atomic-state-writes.zh.md)

The files the Harness keeps on disk — `system_config.yaml`, `.project_config.toml`, `.vault.toml`,
`AGENTS.md`, `MEMORY.md`, schedule files, `GOAL.yaml` — were each overwritten in place, so a crash
or a full disk part-way through a write left the file truncated. A truncated `system_config.yaml`
is not always a loud failure: when the cut lands inside the `system_prompt` block scalar the file
still parses as YAML and the Agent boots with everything after it — the tool list, MCP servers,
vault and skills settings — silently gone, and the next config edit from the web UI persists that
as the new truth. `atomicWriteFile`, until now a private helper of the `write_file` and `edit_file`
tools, moved to core's public surface and is now the single writer behind all of them: content
goes to a temp file in the same directory, is flushed, and is renamed over the target, so a reader
sees either the old bytes or the new ones.

## Details

- The secret-carrying files (`.project_config.toml`, `.vault.toml`) get their `0600` mode from an explicit `chmod` on the temp file, which the umask does not mask, so the mode is exact on creation and on every replacement.
- A config file symlinked into a dotfiles repository is still written through, and so is the shell startup file `penguin lang` edits. The Memory directory is the exception and stays as it was: it is model-writable, so a symlink planted at a topic name is replaced rather than followed out of the scope.
- The Memory index prune, which deletes a topic's lines from `MEMORY.md`, now goes through the same writer as every other Memory write instead of overwriting the index in place.
- The desktop app's `~/.local/bin/penguin` wrapper is renamed into place, so a failed write leaves the previous command on PATH rather than a truncated script.

## Skills

Installing a Skill — from the library or from an imported zip — writes into a dot-prefixed staging
directory and swaps it in as the last step. The old directory was previously deleted first and the
new files written into place one by one, and since the only completeness criterion is that
`<name>/SKILL.md` exists, an install interrupted at the wrong moment left a partial Skill that
looked installed. Both Skill listings skip dot-prefixed directories, which a Skill name can never
be.

## Hot update

An artifact already holding the exact bytes being pushed is left untouched, and anything else is
renamed into place. Re-pushing a version, or rolling back to one installed earlier, rewrote the
content-addressed file the committed manifest was pointing at; a crash during that rewrite left a
manifest referencing a truncated bundle, which the runtime needs to boot.
