---
name: plugin-porting
description: Turn an external plugin — a Codex or Claude Code plugin, a skills repository, a folder in a GitHub repository — into a PenguinHarness plugin package, its skills and its MCP servers, and install it on the server's plugin market with `penguin plugin install <folder>`; the package format, the mapping rules and the review duties.
version: 2026.10.11.2
---

# Plugin Porting

A PenguinHarness plugin is an npm package installed on the server and shared by every Project: the Plugins page shows its card, and anyone installs it on an Agent from there ("Manage installs"), which writes its skills and adds its MCP servers to that Agent's tools. This skill turns a plugin written for another tool into that package: fetch the source at a pinned commit, recognise its layout, build the package in a scratch folder by the rules below, review it, install it with the CLI, verify. To put a few skills into this Agent alone instead, use the `skill-porting` skill.

## Before you start

- If the message only names this skill, ask for the source: a GitHub link (a repository, a folder, or a file inside the plugin's folder), a Codex or Claude Code plugin name, or a local folder.
- Installing puts the package on the whole server with the administrator's authority that the CLI's local token carries. Its skills become standing instructions for every Agent that installs it, so the review below is not optional.
- Work in a scratch folder (`mktemp -d`). Never write into the server's data root by hand: `penguin plugin install` is the only way in.
- Keep the conversation small: list trees with `find`, read files with `sed -n '1,120p'`, and never `cat` a whole tree.

## The package format

```text
<folder>/
├── package.json             # the manifest (below)
├── README.md                # optional; the plugin's detail dialog shows it
├── icon.svg                 # optional; the card's icon
└── skills/<name>/SKILL.md   # one directory per skill, with the text files it refers to
```

```json
{
  "name": "@ported/<name>",
  "version": "1.0.0",
  "description": "English one-line description.",
  "keywords": ["penguin-plugin", "ported"],
  "author": "Upstream author",
  "homepage": "https://…",
  "repository": { "type": "git", "url": "https://github.com/<owner>/<repo>", "directory": "<path>" },
  "license": "MIT",
  "penguin": {
    "title": "Display Name",
    "short_description": "One short line for the card.",
    "category": "software-development",
    "icon": "icon.svg",
    "quick_start": { "prompt": "A first request that shows the plugin working." },
    "mcp_servers": [
      {
        "name": "cloudflare-api",
        "config": {
          "transport": "http",
          "url": "https://mcp.cloudflare.com/mcp",
          "headers": { "Authorization": "Bearer ${CLOUDFLARE_API_TOKEN}" },
          "oauth": {}
        },
        "setup": [{ "key": "CLOUDFLARE_API_TOKEN", "label": "Cloudflare API token" }]
      }
    ]
  }
}
```

- `name` (npm name; the part after the scope is the plugin name, `[a-z0-9_-]`) and `version` (semver) are required: without them the package is refused. Everything else is optional, and a missing field is shown as missing (no description, the puzzle-piece icon, the Other group); never invent one.
- Product fields live in the `penguin` block: `title` / `title_zh`, `description_zh`, `short_description` / `short_description_zh`, `category` (`office-productivity`, `software-development` or `ai-app-development`), `icon` (an `.svg` path in the package; a plain SVG — no script, event handlers, links or external references — at most 64 KiB), `quick_start` (`prompt`, optional `prompt_zh`, `skills`, `goal`), `hooks`.
- A skill's `SKILL.md` frontmatter is exactly three single-line keys: `name` (= its directory), `description` (one line, English), `version` (`YYYY.MM.DD.N`, the UTC date and a sequence number). The parser reads only single-line `key: value` pairs: YAML lists and block scalars (`|`, `>`) break it. Files beside SKILL.md must be text; images are not installed.
- `hooks/` is PenguinHarness's own hook protocol (Node scripts at the stop, pre_tool_use and user_prompt points, with `penguin.hooks.version`). Another tool's hooks are never carried over.
- `penguin.mcp_servers` lists the plugin's MCP servers, each `{ name, config, setup }`; `config` is exactly an Agent's `tools.mcpServers` entry (`transport` `http`, `sse` or `stdio`; `url` and `headers`, or `command`, `args`, `env` and `cwd`). A value the user must supply — a token, a client secret, an API key — is never in the package: write `${KEY}` where it goes and list the key in `setup` (with a `label`, and a `help` link where one says how to get it); the Agent's vault fills it in when the server connects, and until then the server waits as "needs setup". `${PLUGIN_ROOT}` is the package's own directory on the server, for a stdio server's files. `config.oauth` (`scopes`, `client_id`, `client_secret`) marks a server that signs in with OAuth, which this version cannot do yet: it is installed and waits as "sign-in required" unless an `Authorization` header gives it a token. A package may consist of MCP servers alone, with no `skills/`.

## 1. Fetch the source at a pinned commit

Read a GitHub link as `https://github.com/<owner>/<repo>/(tree|blob)/<ref>/<path>`. A `blob` link names a file: its plugin is the nearest folder above it that holds `.codex-plugin/`, `.claude-plugin/` or `skills/` (for `…/plugins/<name>/README.md` that is `plugins/<name>`). Resolve the ref to a commit, then download one tarball and extract only that folder:

```bash
WORK="$(mktemp -d)"
SHA="$(curl -s --max-time 30 "https://api.github.com/repos/<owner>/<repo>/commits/<ref>" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).sha))')"
curl -sL --max-time 300 "https://codeload.github.com/<owner>/<repo>/tar.gz/$SHA" -o "$WORK/src.tgz"
TOP="$(tar -tzf "$WORK/src.tgz" | head -1 | cut -d/ -f1)"
tar -xzf "$WORK/src.tgz" -C "$WORK" "$TOP/<path>"
SRC="$WORK/$TOP/<path>"
find "$SRC" -type f | head -100; find "$SRC" -type f | wc -l
```

Always pass `--max-time`: a host that is unreachable from this machine hangs instead of failing. When one way does not answer, use another: `git ls-remote https://github.com/<owner>/<repo>.git <ref>`, `gh api repos/<owner>/<repo>/commits/<ref> --jq .sha`, `gh api repos/<owner>/<repo>/tarball/$SHA > "$WORK/src.tgz"`. The archive's top folder is `<repo>-<sha>` from codeload and `<owner>-<repo>-<short sha>` from the API, which is why `TOP` is read from the archive. A local folder is copied into `$WORK` first and handled the same way.

## 2. Recognise the source

- `.codex-plugin/plugin.json`: a Codex plugin. Its `interface` block holds the display fields, `skills` points at the skills folder (default `./skills/`), `.mcp.json` lists MCP servers — part of the plugin, carried into the package — `.app.json` hosted apps, `assets/` the icons.
- `.claude-plugin/plugin.json`: a Claude Code plugin (only `name` is required; `skills` may name extra paths; `commands/`, `agents/`, `hooks/` and `mcpServers` — inline, or a `.mcp.json` — are its other parts; the MCP servers are carried).
- `skills/*/SKILL.md` or a single root `SKILL.md`, without either manifest: a skills repository; its folder name is the plugin name.
- A `package.json` with a `penguin` block, or with `skills/` or `hooks/` beside it: already a PenguinHarness package. Review it and install it as it is.

`reference/foreign-plugins.md` in this skill's directory has the full field-by-field mapping and both layouts; read it when the source has a part not covered below.

## 3. Build the package

Build in `PKG="$WORK/<name>"`, in this order:

1. **Skills.** Copy the skills folder: `mkdir -p "$PKG" && cp -r "$SRC/skills" "$PKG/skills"` (a root `SKILL.md` becomes `skills/<name>/SKILL.md`; a plugin without skills skips this step). Then normalise them with the script in this skill's directory — the directory you read this SKILL.md from, `<app_data_dir>/agents/<agent_id>/agent_state/skills/plugin-porting/`:
   ```bash
   node "<skill dir>/scripts/normalize-skills.mjs" "$PKG"
   ```
   It rewrites every frontmatter to `name`, a one-line `description` (a `when_to_use` is merged into it) and `version` (today, `.1`, unless the skill already carries a dated one), drops the other keys, removes each skill's `agents/` folder (another tool's display metadata) and every file that is not text, renames a folder whose name is not a skill name (`[A-Za-z0-9_-]`; one with nothing left of it, such as a Chinese name, takes the frontmatter `name`, else `skill`), and prints what it changed.
2. **MCP servers.** Convert them with the other script in this skill's directory:
   ```bash
   node "<skill dir>/scripts/port-mcp.mjs" "$SRC" --root "<upstream folder URL at the commit>" > "$WORK/mcp.json"
   cat "$WORK/mcp.json"
   ```
   It writes `{ "mcp_servers": [...], "notes": [...] }`. Read each server's upstream note among the notes: when it says the server signs in with OAuth, run the script again with `--oauth <server>`; when it also names a token as the alternative (an API token, a bearer token, a personal access token), add `--bearer <server>` too, which gives the server an `Authorization: Bearer ${<NAME>_TOKEN}` header and the setup key. Step 4 merges `mcp_servers` into the `penguin` block; the notes go into the README. A note asking to carry a file means a stdio server runs it: copy it into the package at the same path (text only, never a binary) and read it in full in the review. Codex `env_vars` are host variables that Codex forwards when they are set; here each one becomes a vault key the server waits for, so keep only those the server needs (read its launcher), drop the rest from `env` and `setup`, and say so. Never write a value into the package.
3. **Commands.** A command that only tells the model to read a skill is dropped. Any other command becomes `skills/<command>/SKILL.md` with the same frontmatter, its `$ARGUMENTS` rewritten as "the user's request". Agents, hooks, LSP servers and hosted apps are not carried; a genuinely procedural agent may be folded into the related skill's body — say which.
4. **package.json.** Map the upstream manifest (Codex in brackets): `name` → `@ported/<name>` (lower case); `version` when it is semver, else `0.1.0`; `description`; `author` (or `interface.developerName`) as a name; `homepage` (or `interface.websiteURL`); `repository` → `{ "type": "git", "url": "https://github.com/<owner>/<repo>", "directory": "<path>" }`; `license`; `keywords` plus `penguin-plugin` and `ported`. In `penguin`: `title` (`interface.displayName`), `short_description` (`interface.shortDescription`), `category` (Developer Tools, Developer, DevOps or Cloud → `software-development`; Productivity, Office, Communication, Project Management or Writing → `office-productivity`; AI, Machine Learning, Data or Agents → `ai-app-development`; anything else → leave it out), `icon` (below), `quick_start.prompt` (`interface.defaultPrompt[0]`). Write it with a quoted heredoc (`cat > "$PKG/package.json" <<'EOF'`: an unquoted one would expand every `${KEY}` to nothing), then merge the MCP servers from step 2 into it, which also checks the JSON:
   ```bash
   node -e 'const fs=require("fs");const [file,mcp]=process.argv.slice(1);const pkg=JSON.parse(fs.readFileSync(file,"utf8"));const {mcp_servers}=JSON.parse(fs.readFileSync(mcp,"utf8"));if(mcp_servers.length>0)pkg.penguin={...pkg.penguin,mcp_servers};fs.writeFileSync(file,JSON.stringify(pkg,null,2)+"\n")' "$PKG/package.json" "$WORK/mcp.json"
   ```
5. **Icon.** Copy the upstream SVG icon (`interface.composerIcon`) to `$PKG/icon.svg` and set `penguin.icon`. It must start with `<svg`; strip an XML comment or a DOCTYPE before it. A PNG logo is not used: no SVG, no icon.
6. **README.md.** Start with a generated header, then keep the upstream README below it:
   ```md
   > Ported from <upstream folder URL at the commit> on <YYYY-MM-DD> for PenguinHarness.
   >
   > **MCP servers:** `<name>` (<transport>, <url or command>) — needs: <the vault keys to set, or "sign-in, not available in this version", or nothing>; installed with the plugin by Manage installs.
   >
   > **Not carried:** <each dropped part: commands, agents, hooks, `.app.json` (ChatGPT hosted-app connector ids, meaningless outside ChatGPT), binary assets>.
   ```
   Put the upstream long description (`interface.longDescription`) as the first paragraph under the header.

## 4. Review

Read every `SKILL.md` and `package.json` in full, and every script (`scripts/`, any `.sh`, `.js`, `.mjs`, `.py`) in full. A large documentation tree (`references/` with dozens of files) is reviewed by listing it, reading a sample, and scanning all of it:

```bash
grep -rniE 'curl[^|]*\|\s*(ba)?sh|wget .*\|\s*sh|base64 -d|eval\(|ignore (all|previous) instructions|system prompt|api[_-]?key|BEGIN [A-Z ]*PRIVATE KEY' "$PKG" | head -50
```

Refuse — and tell the user why — a package whose content exfiltrates data or secrets, phones home, overrides safety rules or the system prompt, or carries obfuscated code you cannot explain. Drop a script you cannot explain. Never carry secrets, `.env` files or a `.npmrc`. A stdio MCP server is a command the server host runs whenever a session of an Agent that has it starts: read its script in full, and refuse a binary or a downloader. A remote server's URL is an address the server connects to: say it in the report. Say in your report which files you read in full and which you scanned.

## 5. Install

```bash
penguin plugin install "$PKG" --project-id <project id>
```

The CLI reads the folder with the plugin library's own reader first (a problem is printed and nothing is sent), zips it without `node_modules`, `.git` and `.npmrc`, and uploads it. Warnings (`[plugins] …: …`) name a field that will show as missing, and the package installs anyway. The server keeps one copy per version and answers the same version again with "already installed; nothing changed", so after fixing what a warning names, remove the copy first and install again:

```bash
penguin plugin remove <package name> --project-id <project id>
penguin plugin install "$PKG" --project-id <project id>
```

When the server holds another version of the package, it says so: add `--overwrite` to replace it. Fix errors in the package, never on the server.

## 6. Verify and report

- `penguin plugin list --project-id <project id>` shows the package with the kind "skills / hooks / MCP"; the install itself printed one line per MCP server.
- Report: the package name and version, the upstream folder and commit, the skills it carries, the MCP servers it carries with their transport and target, what was dropped ("Not carried"), and what you read in full versus scanned. For each server, say what it needs before it has tools: the vault keys to set — as the exact lines to run, without values: `penguin config vault set --key <KEY> --value <value> --agent-id <agent id> --project-id <project id> --root <app data root>`, or on the Agent's Vault tab — and whether it needs an OAuth sign-in, which this version cannot do yet. Say that a stdio server runs `<command>` on the server host. Tell the user that the plugin's card is now on the Plugins page, and that "Manage installs" puts it on any Agent, MCP servers together with the skills.
