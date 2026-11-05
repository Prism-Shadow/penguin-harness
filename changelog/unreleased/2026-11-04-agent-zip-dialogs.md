# Agents export and import through two shared dialogs

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `web`, `ui-gallery`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[中文版](2026-11-04-agent-zip-dialogs.zh.md)

The Web App exports an Agent as a zip and imports one from a zip, or from another coding agent's setup, through two dialogs that the Agents page and the Agent settings page share. They replace the settings page's snapshot export and import and the create dialog's 「Initialize from a snapshot」.

## Details

- **Export.** Each Agent card gained an 「Export agent」 icon, and the settings Overview's Agent State section an 「Export…」 button. The dialog keeps the config always and lets the user pick Skills, Hooks, Memory, Workbenches (with a 「With their data」 sub-option) and Schedules (off by default: imported schedules run), and the conversations as 「None」, 「Latest N」 (20 by default, up to 500) or a 「Date range」. A line from `GET …/archive/preview`, asked again 300 ms after the last change, gives the file count, the size and the conversations, with a note past 100 MB uncompressed and the conversations left out for a file too large. Export downloads `<agentId>-<yyyymmdd>.zip` from the server the Agent lives on; a refusal is a toast. The controls apply at once and are not remembered.
- **Import.** The Agents page header gained 「Import agent」, beside the create pair. Its first section, 「Migrate from another framework」, picks Claude Code, Codex, DeepSeek Harness, Qoder, Qwen Code, WorkBuddy or Other, takes a path (the framework's user directory by default, required for Other), previews the full prompt, and opens a new conversation with the Project's default agent with that prompt in the message box: it names the framework, the path and the Project, and asks for the `agent-porting` Skill and a `penguin agent import` into the Project. Its second section, 「Import a file」, takes a `.zip` (or, until 1.0, an older `.tar.gz` package; see [backward compatibility](2026-11-04-backward-compatibility.md)), prefills the Agent id from the file name, and uploads the file as a raw `application/octet-stream` body. A taken id (409 `agent_exists`) shows in place with 「Use another id」 and, for the Project owner, 「Overwrite the existing agent」, which confirms once and resends with `overwrite=1`. A landed import toasts what came in, the skipped conversations and the keys to fill in, and the Agent list is read again.
- **Replace from file.** The settings Overview's 「Replace from file…」 (owner only) opens the import dialog without the migration section and the id: one danger confirmation, then the upload with `overwrite=1` under this Agent's id, and the page reads the config again. The version-conflict prompt is gone.
- The create dialog's snapshot seed was removed; its footer leads to 「Import agent」 instead. The web client dropped `agentExportUrl` and `importAgent`, and gained `agentArchiveUrl`, `previewAgentArchive` and `agentImportUrl`; the archive download helper also reads a plain quoted `filename="…"`. The component gallery answers the preview, the download and the import (read-only) in its mock API.
- The Agents and Web App docs describe the two dialogs, the export icon and replace from file.
