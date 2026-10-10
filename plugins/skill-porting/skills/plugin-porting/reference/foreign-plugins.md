# Foreign plugin layouts and the mapping to a PenguinHarness package

Verified against files fetched on 2026-10-10. Trust the files you actually fetched over this
snapshot.

## Codex plugin (`openai/plugins` and others)

```text
plugins/<name>/
├── .codex-plugin/plugin.json   # npm-like manifest plus an `interface` display block
├── .mcp.json                   # { "mcpServers": { "<id>": { "type": "http", "url": "…", "note": "…" } } }
├── .app.json                   # hosted connector ids (no PenguinHarness equivalent)
├── commands/*.md               # slash commands: frontmatter `description`, `argument-hint`, `allowed-tools`
├── assets/                     # composer icon (SVG) and logo (PNG)
├── README.md
└── skills/<skill>/
    ├── SKILL.md                # frontmatter `name` + `description` (sometimes a `|` block or extra keys)
    ├── agents/openai.yaml      # Codex display block for the skill: dropped
    ├── assets/                 # per-skill copies of the icons
    ├── references/, scripts/   # support files
    └── LICENSE.txt
```

`plugin.json` fields: `name`, `version`, `description`, `author {name, url}`, `homepage`,
`repository`, `license`, `keywords`, `skills` (`./skills/`), `mcpServers` (`./.mcp.json`),
`apps` (`./.app.json`), and `interface {displayName, shortDescription, longDescription,
developerName, category, capabilities, websiteURL, privacyPolicyURL, termsOfServiceURL,
defaultPrompt[], composerIcon, logo, screenshots, brandColor}`.

## Claude Code plugin

```text
<plugin>/
├── .claude-plugin/plugin.json  # only `name` is required
├── skills/<skill>/SKILL.md     # default skills location (more paths may be listed in `skills`)
├── commands/*.md               # flat one-file commands
├── agents/*.md                 # subagent definitions
├── hooks/                      # Claude Code hook events
└── .mcp.json                   # or `mcpServers` inline in plugin.json
```

`plugin.json` fields: `name`, `description`, `author` (string or `{name, email, url}`), `version`,
`homepage`, `repository`, `license`, `keywords`, `skills` (string or array), `commands`, `agents`,
`hooks`, `mcpServers`, `lspServers`. A marketplace (`.claude-plugin/marketplace.json`) lists
plugins with a `source` (a path in the same repository, or a git URL with a pinned sha) and a
`category`.

## The mapping

| Upstream | Codex | Claude Code | → package |
| --- | --- | --- | --- |
| name | `name` | `name` | `name: "@ported/<name>"` (lower case, `[a-z0-9-]`) |
| version | `version` | `version` (optional) | `version` when semver, else `0.1.0` |
| description | `description` | `description` | `description` |
| display name | `interface.displayName` | — | `penguin.title` |
| short description | `interface.shortDescription` | — | `penguin.short_description` |
| long description | `interface.longDescription` | — | first paragraph under the README header |
| developer | `interface.developerName`, `author` | `author` | `author` (a name) |
| links | `homepage`, `repository`, `interface.websiteURL` | `homepage`, `repository` | `homepage`; `repository: {type: "git", url, directory}` — the upstream folder is the provenance; privacy and terms URLs go to the README |
| license, keywords | same | same | same, plus `penguin-plugin` and `ported` |
| category | `interface.category` | marketplace `category` | Developer Tools / Developer / DevOps / Cloud → `software-development`; Productivity / Office / Communication / Project Management / Writing → `office-productivity`; AI / Machine Learning / Data / Agents → `ai-app-development`; else omitted (Other) |
| default prompt | `interface.defaultPrompt[0]` | — | `penguin.quick_start.prompt` |
| icon | `interface.composerIcon` (SVG) | — | `icon.svg` + `penguin.icon`; a PNG `logo` is not used |
| skills | `skills` (default `./skills/`) | `skills`, default `skills/`, else a root `SKILL.md` | `skills/<dir>/` normalised by `scripts/normalize-skills.mjs` |
| commands | `commands/*.md` | `commands/*.md` | dropped when the body only routes to a skill; otherwise a skill of its own |
| agents | — | `agents/*.md` | dropped (a procedural one may be folded into a skill's body) |
| hooks | — | `hooks/` | dropped: not the PenguinHarness hook protocol |
| MCP servers | `.mcp.json` | `mcpServers` | not in the package; listed in the README for the user to add on an Agent's Tools tab (MCP servers) |
| apps, LSP | `.app.json` | `lspServers` | dropped, named in the README |
| root assets | `assets/` | — | only the SVG icon is taken |
| README | `README.md` | `README.md` | kept, under the generated header |
