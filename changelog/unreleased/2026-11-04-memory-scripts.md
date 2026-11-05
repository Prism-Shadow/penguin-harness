# Memory keeps the agent's reusable scripts

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1487](https://github.com/Prism-Shadow/penguin-harness/pull/1487)
- **Breaking:** yes — memory export files are version 2, which servers from before this change refuse

[中文版](2026-11-04-memory-scripts.zh.md)

A memory scope can hold a `scripts/` folder of programs the agent reuses. The agent writes a script with the file tools, lists it in the scope's `MEMORY.md` with how to run it, and runs it through `exec_command`, under the Session's sandbox, approval mode and command policy. No tool was added, and a scope without `scripts/` behaves as before.

## Prompt and kernel

- The default Memory prompt names reusable scripts beside facts and gained a **Scripts:** paragraph. A program the model would otherwise rewrite goes in the scope's `scripts/` as one self-contained file with a usage comment at the top, and is indexed as `- [Title](scripts/name.py) — what it does · run: python3 scripts/name.py <args>`. It runs by absolute path through its interpreter, because files have no execute bit. Secrets stay in the vault, and a script the Session did not write is read before it runs.
- `KERNEL_VERSION` moved to `2026-11-04`, and the Memory tab's previous default was recorded as superseded. An existing agent adopts the paragraph through **Update kernel**; a Memory tab that was edited keeps its text.
- Adopting the new prompt makes each running conversation of that agent re-read its cached prompt prefix once, at its next context rotation.

## Server

- `GET …/memory/scopes/:key/files` lists a scope's scripts after its topic files. Every entry carries `kind` (`topic` or `script`) and `path`: the file name for a topic, `scripts/<name>` for a script.
- `GET` and `DELETE …/files/scripts/:name` read and delete a script, and a delete removes its `MEMORY.md` line. A script over 512 KB is refused with 413 `memory_script_too_large`, and one that is not UTF-8 text with 415 `memory_script_not_text`.
- A `scripts` that is a symlink or a file holds no scripts: nothing under it is listed, read or deleted, and an import that brings scripts there is refused with 409 `memory_scripts_not_a_directory` before anything is written.
- The export document is `version: 2`. Each entry names its `path`, scripts travel with the topics, and a script over 512 KB or not UTF-8 text is listed in `omitted` with its size and reason instead. An import takes at most 100 scripts, and `replace` deletes scripts the document does not carry. Version 1 files still import; see [backward compatibility](2026-11-04-backward-compatibility.md).
- The agent list's memory count and each scope's `fileCount` include scripts.

## Web App

- The Memory tab lists a group's scripts under **Scripts**, below its memories, with each script's size and date. The heading's "?" says who may run and read them. **View** shows the script's path and its code, read-only, with line numbers; **Delete** removes it after a confirmation. Scripts have no **Edit**.
- An export that left scripts out names them in a notice.
- The chat's Memory panel lists scripts by path and opens one as code. A script the conversation wrote is no longer dropped from the memory-changes card as if it had been deleted.

## Docs

- Configuration › Memory gained a Scripts section. The agents page's Memory tab and the server API's Memory routes describe scripts and the version 2 document.

## Compatibility

- A memory file exported by this version cannot be imported into a server from before it, which refuses the unknown version. Update that server first.
- In the export route's response, and in a document sent to import, an entry carries `path` where it carried `name`. A client that read `files[].name` reads `files[].path`.
