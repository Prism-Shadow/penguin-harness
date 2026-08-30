# An Agent's definition publishes to a GitHub gist and installs from a gist, npm, GitHub, git or a URL

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-08-30-agent-packages.zh.md)

An Agent can now be shared as a *package*: its definition — `agent_state/` (system config, prompt, skills, tools) and `workflows/` (the code and pages it keeps for itself) — published to a GitHub gist as a set of readable text files, and installed from such a gist as a new Agent on any harness. What the Agent has become stays behind: memory, workspaces, scratchpad, benchmark results, a workflow's `state.json`, the version history, and the vault are never packaged, so an installed copy is the same Agent with nothing lived in it.

## Format

A gist has no directories, so paths flatten into file names (`agent_state/skills/x/SKILL.md` → `agent_state--skills--x--SKILL.md`) and `penguin-agent.json` carries the manifest (format `1`, the Agent's id, name and description, the harness version that packaged it, and every file with its path and encoding). Text ships verbatim so the gist page reads and diffs; binary files are base64. A package is capped at 5 MB, and a path containing `--` cannot be packaged (it would not round-trip).

Installing validates every entry before a byte is written: the manifest's format, that each path is relative, escapes nothing and lies under a packaged prefix, that the file name matches its path, and that GitHub did not truncate the file. The Agent is created through the normal lifecycle first and the files written into it after; a failure removes the half-made Agent.

## Routes

`GET /api/projects/:p/agents/:a/package` shows what would be published (manifest, size, whether the server can publish). `POST …/package/publish { gistId?, public? }` (owner) publishes, or updates the named gist in place so a republished Agent keeps its URL. `POST /api/agent-packages/preview { gist }` reads and validates a gist, writing nothing; `POST /api/agent-packages/install { gist, projectId, agentId }` (owner) installs it. A gist is named by its URL or bare id.

## Other sources

Installing reads more than gists. A source is any of: a gist link or id; `npm:<name>[@version]` (the registry's tarball); a GitHub repository — `https://github.com/o/r`, `…/tree/<ref>` or `github:o/r[#ref]` — as its tarball at that ref, the default branch when none; a GitHub release — `…/releases/latest`, `…/releases/tag/<tag>` or `github-release:o/r[#tag]` — taking a `.tgz`/`.tar.gz` asset when the release has one, else its source tarball; a git URL (`git+…`, `git@…`, `ssh://`, anything ending in `.git`, `#ref` for a branch or tag) as a shallow clone, which needs a `git` binary on the server; and any other http(s) URL, as a tarball. The kind is detected from the shape, or forced with `kind`. A tarball's single top-level folder (`package/`, `owner-repo-sha/`) is stripped.

A directory-shaped source needs no manifest: whatever in it is an Agent's definition — `agent_state/`, `workflows/`, under the same exclusions — is the package, so a repository that simply *is* an Agent directory installs as it stands. With a `penguin-agent.json` present, every entry must be there (by path or flattened name) and passes the same checks as a gist. Trees are capped at 2000 files.

## Token

Publishing uses one GitHub token (scope `gist`) stored as the server setting `github_token` — plaintext at rest like the messaging credentials and the proxy address, and write-only at every API surface: `GET /api/admin/settings` reports `githubTokenSet`, `PUT` takes `githubToken` (empty clears it). Reading a public gist needs no token, so installing works with none configured.

## Web App

Settings gains a **Sharing** page (admin) for the token. An Agent's overview has **Publish to gist** beside the snapshot export/import: the dialog lists exactly what will be sent and what is left out, offers the gist it published to before (remembered per Agent) so republishing updates it, and shows the resulting link. The Agents page has **Install an Agent**: paste any source (the kind is detected, a select forces one), read it (name, description, resolved origin, file count, size, packaging version), choose the new Agent's id — the manifest's, or the source's name — and install.
