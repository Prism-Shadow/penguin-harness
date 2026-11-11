# A memory keeps the agent's reusable scripts

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1487](https://github.com/Prism-Shadow/penguin-harness/pull/1487)
- **Breaking:** yes — memory export files are version 2, which servers from before this change refuse

[中文版](2026-11-04-memory-scripts.zh.md)

A memory can keep programs the agent reuses, in a folder named after its file without `.md`: `csv-tools.md` keeps `csv-tools/`. The folder holds any number of files, in any language and at any depth. The memory's body says what each file does and how to run it, and its `MEMORY.md` line stays the only one. The agent writes the files with the file tools and runs them through `exec_command`, under the Session's sandbox, approval mode and command policy. No tool was added, and a memory without a folder behaves as before.

## Prompt and kernel

- The default Memory prompt names the scripts a fact keeps and gained a **Scripts:** paragraph. A program the model would otherwise rewrite is kept by the fact it serves, in that fact's folder, with no dependencies beyond its interpreter, and the fact's body links each file relatively and says how to run it. A script runs by absolute path through its interpreter, because files have no execute bit, and its folder is deleted with its fact. Secrets stay in the vault, and a script the Session did not write is read before it runs.
- `KERNEL_VERSION` moved to `2026-11-10`, and the Memory tab's previous default was recorded as superseded. An existing agent adopts the paragraph through **Update kernel**; a Memory tab that was edited keeps its text.
- Adopting the new prompt makes each running conversation of that agent re-read its cached prompt prefix once, at its next context rotation.

## Server

- `GET …/memory/scopes/:key/files` gives each topic its `files`: every file in its folder, with its path in the scope, size and date. `orphanFiles` lists the files of folders that have no topic of their name, so nothing on disk is hidden.
- `GET` and `DELETE …/files/<folder>/<path>` read and delete one kept file. A read hands out at most 512 KB of UTF-8 text: 413 `memory_file_too_large` past it, 415 `memory_file_not_text` otherwise. A delete also removes the folders it leaves empty.
- Deleting a topic deletes its folder too.
- A folder, or a file inside one, planted as a symlink is never followed: nothing through it is listed, read or deleted, and deleting the topic leaves the link's target alone.
- The export document is `version: 2`: a topic carries its files. A file over 512 KB, one that is not UTF-8 text and one in a folder no topic keeps are listed in `omitted` with their size and reason instead.
- An import acts on a topic and its folder together. `overwrite` leaves a replaced topic's folder holding exactly the document's files, and `replace` also deletes the folders the document does not carry, naming each in its confirmation. A folder with no topic counts as its topic being present. A non-directory at a topic's folder or on the way to one of its files refuses the import with 409 `memory_folder_not_a_directory` before anything is written. Only the existing per-file and per-document byte limits apply; how many files a topic keeps is not limited.
- Version 1 files still import; see [backward compatibility](2026-11-04-backward-compatibility.md).

## Web App

- On the Memory tab, a memory that keeps files shows a paperclip with their number. Its view shows the Markdown, then its files with path, size and date. **View** opens a file read-only, with line numbers, and **Back to** returns to the memory; **Delete** removes it after a confirmation. Deleting the memory says how many files go with it. Files have no **Edit**.
- A group lists the files of folders no memory keeps under **Files without a memory**.
- An export that left files out names them in a notice.
- The chat's Memory panel and the memory-changes card show a file the conversation wrote under the memory that keeps it, by its path, instead of dropping it as if it had been deleted.

## Docs

- Configuration › Memory gained a Scripts section. The agents page's Memory tab and the server API's Memory routes describe the files a memory keeps and the version 2 document.

## Compatibility

- A memory file exported by this version cannot be imported into a server from before it, which refuses the unknown version. Update that server first.
