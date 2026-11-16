# A memory keeps the agent's reusable scripts

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1487](https://github.com/Prism-Shadow/penguin-harness/pull/1487)
- **Breaking:** yes — a memory export is a zip, which servers from before this change refuse

[中文版](2026-11-04-memory-scripts.zh.md)

A memory can keep programs the agent reuses, in a folder named after its file without `.md`: `csv-tools.md` keeps `csv-tools/`. The folder holds any number of files, in any language and at any depth. The memory's body says what each file does and how to run it, and its `MEMORY.md` line stays the only one. The agent writes the files with the file tools and runs them through `exec_command`, under the Session's sandbox, approval mode and command policy. No tool was added, and a memory without a folder behaves as before.

## Prompt and kernel

- The default Memory prompt names the scripts a fact keeps and gained a **Scripts:** paragraph. A program the model would otherwise rewrite is kept by the fact it serves, in that fact's folder, with no dependencies beyond its interpreter. The fact's own body lists each file with what it does, how to run it and a relative link; `MEMORY.md` never lists them and keeps one line per fact. A script runs by absolute path through its interpreter, because files have no execute bit, and its folder is deleted with its fact. Secrets stay in the vault, and a script the Session did not write is read before it runs.
- `KERNEL_VERSION` moved to `2026-11-10`, and the Memory tab's previous default was recorded as superseded. An existing agent adopts the paragraph through **Update kernel**; a Memory tab that was edited keeps its text.
- Adopting the new prompt makes each running conversation of that agent re-read its cached prompt prefix once, at its next context rotation.

## Server

- `GET …/memory/scopes/:key/files` gives each topic its `files`: every file in its folder, with its path in the scope, size and date. `orphanFiles` lists the files of folders that have no topic of their name, so nothing on disk is hidden.
- The file routes take a path: `GET` and `DELETE …/files/<folder>/<path>` read and delete one kept file through the same routes as a topic. A read hands out at most 512 KB of UTF-8 text: 413 `memory_file_too_large` past it, 415 `memory_file_not_text` otherwise. A delete also removes the folders it leaves empty. Deleting a topic deletes its folder too.
- A folder, or a file inside one, planted as a symlink is never followed: nothing through it is listed, read or deleted, and deleting the topic leaves the link's target alone.
- `GET …/export` answers with a zip of the scope folder: `MEMORY.md`, every topic and every folder's files at its root, as the files they are. It shares the Skill archive's checks and caps (1,000 files, 5 MB each, 20 MB in all; 413 `memory_too_large` past them).
- `POST …/import` takes that zip as `dataBase64`. An entry that is no memory file, climbs out, hides behind a dot, is a link, or names a file twice where letter case is ignored refuses the whole zip. A memory is a topic and its folder and moves as one: `overwrite` replaces both, `replace` also deletes the memories the zip does not carry, and a folder with no topic counts as a memory of its own. The 409 that asks for confirmation names what is at stake in its `details`. Only topic lines are ever added to or pruned from `MEMORY.md`.
- A non-directory at a memory's folder or on the way to one of its files refuses the import with 409 `memory_folder_not_a_directory` before anything is written.
- The JSON document earlier versions exported still imports, as `payload`; see [backward compatibility](2026-11-04-backward-compatibility.md).

## Web App

- On the Memory tab, a memory that keeps files shows a paperclip with their number. Its view shows the Markdown, then its files with path, size and date. **View** opens a file read-only, with line numbers, and **Back to** returns to the memory; **Delete** removes it after a confirmation. Deleting the memory says how many files go with it. Files have no **Edit**.
- A group lists the files of folders no memory keeps under **Files without a memory**.
- **Export** downloads the zip; **Import** takes a zip, or a JSON file an earlier version exported, and asks before an import that would overwrite or delete, naming the memories the server says are at stake.
- The chat's Memory panel and the memory-changes card show a file the conversation wrote under the memory that keeps it, by its path, instead of dropping it as if it had been deleted.

## Docs

- Configuration › Memory gained a Scripts section. The agents page's Memory tab and the server API's Memory routes describe the files a memory keeps and the zip export.

## Compatibility

- A memory export is a zip now, which a server from before this change cannot import. Update that server first.
- `GET …/export` answers with a zip instead of a JSON document, so a client that read the document reads the zip's files. `POST …/import` still takes the JSON document as `payload`.
