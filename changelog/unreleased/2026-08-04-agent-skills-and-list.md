# Web App: skills management on the Agent settings page, deep-linked list icons

## Skills tab

Agent settings gains a Skills tab, placed right after Tools. The installed list re-reads `agent_state/skills/` on every fetch — the directory stays the single source of truth, exactly as the vault and schedule files do, so hand-installed or agent-installed skills show up without any registry. Rows carry the skill icon, name, localized short description and version/updated metadata; uninstalling asks for confirmation first.

An Import dialog opens from the tab header and leads with the recommended path: install by chatting with the agent. Paste the URL of a page that documents the skill and copy a generated prompt that instructs the agent to read the page in full and review it before writing anything into its skills directory (a shortcut to open a new chat with that agent is included) — the agent can adapt what it installs, which a blind unzip cannot. The dialog's second path uploads a skill zip: a new member-level `POST /api/projects/:p/agents/:a/skills/archive` accepts the archive as base64 JSON (the API's established upload shape), takes `SKILL.md` at the zip root or inside exactly one top-level directory, derives the name from that directory (frontmatter otherwise) under the usual name pattern, rejects path-escaping entries, and caps the payload at 200 files / 5 MB per file / 20 MB uncompressed. Uploading a name that is already installed answers 409 and the dialog offers an explicit overwrite, which replaces the directory wholesale. Unzipping uses a new `fflate` dependency in the server package.

The reverse direction ships too: each row carries an export button that downloads the installed skill as `<name>.zip` — the whole directory under a single top-level folder, served as a direct attachment like the trace download, under the same size caps — so a skill round-trips through the import endpoint unchanged.

## Agent list

The tools, vault-keys, schedules and skills stat icons on each agent row are now buttons that open the settings page landed on the matching tab. Settings learned a `?tab=` deep link for this: the value is validated against the live tab list (unknown values fall back to Overview) and tab switches keep the URL in sync without polluting history. The active-session count badge is gone from list rows — the sessions column already tells the story there — while the settings Overview keeps its active-session figure.
