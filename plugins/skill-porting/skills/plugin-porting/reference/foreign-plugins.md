# Foreign plugin layouts and the mapping to a PenguinHarness package

Verified against files fetched on 2026-10-10. Trust the files you actually fetched over this
snapshot.

## Codex plugin (`openai/plugins` and others)

```text
plugins/<name>/
├── .codex-plugin/plugin.json   # npm-like manifest plus an `interface` display block
├── .mcp.json                   # { "mcpServers": { "<id>": { … } } } — see "MCP server shapes"
├── .app.json                   # ChatGPT hosted-app connector ids: meaningless outside ChatGPT
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
| MCP servers | `.mcp.json` | `mcpServers` (inline, or `.mcp.json`) | `penguin.mcp_servers`, by `scripts/port-mcp.mjs` (rules below); listed in the README header with what each needs |
| apps, LSP | `.app.json` | `lspServers` | dropped, named in the README: `.app.json` holds ChatGPT hosted-app connector ids (`connector_…`), which resolve only inside ChatGPT's app runtime — there is nothing to connect to from outside |
| root assets | `assets/` | — | only the SVG icon is taken |
| README | `README.md` | `README.md` | kept, under the generated header |

## MCP server shapes

Codex (`openai/plugins`, 2026-10): a remote server is `type` + `url`, sometimes with `scopes`, an
`oauth` block and a `note`; a local one is `command` + `args` + `cwd`, with `env_vars` naming the
host variables Codex forwards when they are set.

```json
{ "mcpServers": {
  "cloudflare-api": { "type": "http", "url": "https://mcp.cloudflare.com/mcp",
                      "note": "… OAuth on first connection, with optional bearer-token auth …" },
  "gmail": { "type": "http", "url": "https://gmailmcp.googleapis.com/mcp/v1", "scopes": ["…"],
             "oauth": { "callback_port": 12798, "client_id": "<GMAIL_PUBLIC_CLIENT_ID>",
                        "client_secret": "<GMAIL_CLIENT_SECRET>" } },
  "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/",
              "oauth": { "client_id": "Iv23…", "client_secret": "<literal>", "callback_url": "…" } },
  "codex-security": { "command": "./scripts/launch_codex_security_mcp", "args": ["--stdio"],
                      "cwd": ".", "env_vars": ["OPENAI_API_KEY", "…"] }
} }
```

Claude Code: the same map, with or without the `mcpServers` wrapper; `type: "http" | "sse"` +
`url` + `headers`, or `command` + `args` + `env`; `${CLAUDE_PLUGIN_ROOT}` is the plugin's folder and
`${VAR}` / `${VAR:-default}` a variable of the user's environment.

```json
{ "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/",
              "headers": { "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" } },
  "telegram": { "command": "bun", "args": ["run", "--cwd", "${CLAUDE_PLUGIN_ROOT}", "start"] } }
```

What `scripts/port-mcp.mjs` makes of them (`<NAME>` is the server name upper-cased, `_` between
words):

| Upstream | → `penguin.mcp_servers[]` |
| --- | --- |
| the map key | `name`: lower case, `[^a-z0-9_-]` → `-`; a name taken twice gets `-2` and a note |
| `type: "http"` / `"sse"` + `url`; `command` | `config.transport` `http` / `sse` / `stdio`; a URL must be http(s) and its host fixed, else the server is not carried |
| `command`, `./` arguments, `cwd` | a file of the plugin becomes `${PLUGIN_ROOT}/<path>`, and a note names the file to carry into the package; a server whose command or argument leaves the plugin (`../x`, `./../x`, `bin/../../x` alike) is not carried, and a `cwd` leaving it is dropped |
| Codex `env_vars` | `env: { NAME: "${NAME}" }` + a setup key each — keep only what the server needs |
| `${CLAUDE_PLUGIN_ROOT}` | `${PLUGIN_ROOT}` |
| `${VAR}`, `${VAR:-default}` | `${VAR}` + a setup key (the default is named in a note) |
| `<PLACEHOLDER>` anywhere | `${PLACEHOLDER}` + a setup key labelled with its words |
| a literal token in a header | `${<NAME>_TOKEN}` + a setup key + a note: never carried |
| `oauth`, `scopes`, `oauth_resource` | `config.oauth { scopes?, client_id?, client_secret? }` |
| `oauth.client_id` (literal) | kept: a public identifier |
| `oauth.client_secret` (literal) | `${<NAME>_CLIENT_SECRET}` + a setup key + a note: never carried |
| `callback_port`, `callback_url`, `oauth_resource` | left behind: another client's sign-in flow |
| `note` | a note, for the README |
| prose saying it signs in with OAuth / names a token alternative | `--oauth <server>` / `--bearer <server>` |
