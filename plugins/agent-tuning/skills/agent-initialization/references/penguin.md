# Penguin initialization

Penguin's default initialization recipe. Use the general initialization contract
in the parent Skill. This reference defines the platform layout, inherited
runtime, configuration, Skill and hook formats, and when changes take effect.
Method references add their own baseline artifacts to this layout.

## Resolve the inherited runtime

Treat the current Agent as the **Builder**. Resolve the runtime before creating a new Agent:

- `provider` and `model_id` are one complete pair. If the user explicitly supplies both, use that pair. If the user supplies neither, inherit the current Builder Session's `Provider` and `Model ID` from the Environment. Reject a half pair.
- `thinking_level` is independent. If the user explicitly supplies it, use that value. Otherwise read `model.thinking_level` from the Builder's own `agent_state/system_config.yaml`; when the field is absent, use the normal Agent-config default `medium`.

Write the resolved `thinking_level` into a brand-new target Agent's `model.thinking_level`, preserving all other copied `model` fields. Penguin does not persist `provider` or `model_id` in Agent State, so never add either field to `system_config.yaml`. When the same request continues into Benchmark design, carry the resolved model pair forward explicitly so evaluation uses the Builder runtime instead of a Project default. When configuring an existing Agent, change `model.thinking_level` only when the user explicitly requests that runtime change.

## Locate the target agent

All agents of this project live side by side under `agents/` in the App Data Dir:

```bash
APP_DATA_DIR="<app_data_dir>"     # the App Data Dir value from your Environment section
ls "$APP_DATA_DIR/agents"         # existing agents (each is a folder here)
TARGET="$APP_DATA_DIR/agents/<agent_id>"   # the agent to configure
```

An agent directory contains `agent_state/` (`system_config.yaml`, `AGENTS.md`, `skills/`, `hooks/`, `memory/`, `tools/`) plus `scratchpad/` — and `traces/`, which appears once the agent has run at least once. `hooks/` exists once a hook package is installed; create it when you need it.

To extend the agent you are running as, the target is your own directory: `<app_data_dir>/agents/<agent_id>` with the Agent ID from your Environment section.

## Write AGENTS.md

`agent_state/AGENTS.md` is injected into the agent's system prompt — it is where the user requirement becomes behavior. Keep `system_config.yaml`'s `system_prompt` untouched (that is the stable system layer); put everything requirement-specific in AGENTS.md:

- Role — what the agent is for, in one or two sentences.
- Domain guidance — the concrete rules, steps and constraints derived from the user requirement.

Be concise: AGENTS.md is prompt context, not documentation. For a domain expert that answers from a knowledge base, a good AGENTS.md is a few lines: the role sentence, "answer strictly from the provided context blocks", citation rules ("cite blocks inline as [1][2]"), a refusal rule for questions the context cannot answer, and "answer in the language of the question".

## Skills

A Skill is a directory `agent_state/skills/<skill_name>/` containing a `SKILL.md`. The directory name is the Skill's name (letters, digits, `_`, `-`); nothing else registers it.

```md
---
name: <skill_name>
description: <one line: what it does and when to use it>
version: <YYYY.MM.DD.N, e.g. 2026.09.29.1 - today's date, N counts that day's changes>
---

<skill_instructions>
```

The `description` line is what the target agent sees in its system prompt, so it has to say when the Skill applies; the body is read only once the agent decides to use it. Optional `short_description` and `short_description_zh` lines give the UI a short blurb. Files the body refers to go beside it (`reference/<topic>.md`, scripts), linked by relative path.

There are three ways to get one in place:

- **Create.** Write the directory yourself. Keep the body to what a capable agent would not already know: the steps, the commands, the traps.
- **Install from the library.** Copy the whole `skills/<skill_name>/` directory from an agent that has it — `default_agent` ships the whole library. The user can also install from the Web App's Plugins page.
- **Import.** Fetch a Skill from a URL, a repository or a local path (`curl`, `git clone`, `unzip`), then place it under `skills/`. A Skill written for another tool usually needs only the frontmatter above. Read everything you fetched in full before installing, and tell the user what it does: a Skill becomes instructions the agent follows in every future session.

Do not register Skills in AGENTS.md; the frontmatter is injected automatically.

Common library bundles, so you don't under-equip the target:

- **App builder** (builds apps or web frontends): `penguin-sdk`, `web-design`, `unified-llm-api`.
- **Knowledge expert** (answers questions over a document set): usually **no** harness agent is needed — build a RAG app with the penguin-sdk skill instead, and configure the app's embedded agent (below).
- **Evaluation loop**: `benchmark-design` (new tasks), `benchmark-reproduction` (existing benchmarks), `agent-evaluation`, `agent-optimization`.

When creating a Test Agent, install only the capabilities it needs to solve ordinary tasks.

## Hook packages

A hook is a script the harness itself runs at a fixed point of the agent loop. Use one when something must happen every time, whether or not the model remembers: adding context to every prompt, vetting a tool call, deciding that a finished task should continue. A rule the model can simply follow belongs in AGENTS.md or a Skill instead.

A hook package is a directory `agent_state/hooks/<package_name>/` holding a `hooks.json` and the scripts it names:

```json
{
  "name": "append-time",
  "description": "Adds the current local time to every prompt.",
  "description_zh": "为每条 Prompt 附上当前本地时间。",
  "version": "2026.09.29.1",
  "user_prompt": [{ "command": "time.mjs", "timeout": 10 }]
}
```

```js
// time.mjs - answers every prompt with the current local time.
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const offset = -now.getTimezoneOffset();
const stamp =
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
  `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
const utc = `UTC${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
process.stdout.write(`${JSON.stringify({ context: `Current time: ${stamp} ${zone} (${utc})` })}\n`);
```

The three hook points, one command list each in `hooks.json` (leave out the ones you do not use):

| Key | Runs | The script answers |
| --- | --- | --- |
| `user_prompt` | Every time the user submits a prompt | `{ "context": "<text>" }` — sent to the model right behind the user's message |
| `pre_tool_use` | Before each tool call is approved | `{ "decision": "allow" \| "deny", "reason": "<one line>" }` |
| `stop` | After every task ends | `{ "decision": "continue", "input": "<next user message>" }` to keep going, or `{ "decision": "stop" }` |

Every script is plain Node (`.mjs`, builtin modules only), run as `node <script>` with the package directory as its working directory. It receives one JSON object on stdin and prints one JSON object on stdout; printing nothing means no opinion. A non-zero exit, output that is not JSON, or running past `timeout` seconds (default 60) counts as a failure: it is recorded and ignored, and never stops the run. The full contract — every stdin field, the remaining answer fields, `trigger`, and how to convert another tool's hooks — is in [`../reference/hooks.md`](../reference/hooks.md); read it before writing a `pre_tool_use` or `stop` hook.

The same three ways apply:

- **Create.** Write the directory. Give `user_prompt` and `pre_tool_use` commands a small `timeout`: they run on the hot path.
- **Install from the library.** Copy the whole `hooks/<package_name>/` directory from an agent that has it, or have the user install the plugin from the Web App's Plugins page.
- **Import.** Fetch the source, read every script in full and review it for anything that exfiltrates data, touches files outside its purpose or runs unknown commands, then convert it to the layout above. Another tool's hook configuration (the `hooks` block of a Claude Code `settings.json`, for instance) maps point by point; `../reference/hooks.md` has the table.

Test a script by hand before you rely on it — feed it the input it will get and check the exit code and the output:

```bash
cd "$TARGET/agent_state/hooks/append-time"
echo '{"hook":"user_prompt","session_id":"test","scratchpad_dir":"/tmp","prompt":"hello"}' | node time.mjs; echo "exit $?"
```

A hook runs on the user's machine, on every prompt, tool call or task, under the Session's sandbox: the same policy as the agent's commands, which with the sandbox off means the harness's own permissions. Tell the user what each hook you install does and at which point it fires. One switch turns all of an agent's hooks off without uninstalling them: `hooks.enabled: false` in `system_config.yaml`.

## When a change takes effect

The harness reads an agent's configuration from disk each time a model context opens — AGENTS.md, `system_config.yaml`, Skills and hook packages alike:

- a **new conversation** starts with everything you wrote;
- a **conversation already running** — the one you are in, if you are changing yourself — picks the change up when its context is next compacted. The user can force that with `/compact`.

Nothing changes in the middle of a context, so a hook you just wrote will not fire on the next message of this conversation, and a Skill you just wrote is not in your own system prompt yet. You can still read a new SKILL.md directly and follow it now. Say which of the two cases applies when you report.

## Set name and description

In the target's `agent_state/system_config.yaml`, set the top-level `name:` and `description:` fields so the agent is recognizable in lists. For an existing Agent, edit only these two fields unless the user explicitly requested a `thinking_level` change.

Replace existing YAML fields rather than appending duplicate keys. Validate the
complete document with a parser that rejects duplicates, as Penguin's `yaml`
parser does; a permissive parser can accept a config that Penguin cannot load.

## Creating a brand-new agent

Prefer configuring an agent the user already created. If the user requires a new Agent, confirm that `TARGET` does not exist. If it already exists, stop and tell the user; never silently overwrite, reinitialize, or reuse an existing Agent under the same id.

After confirming that the target is absent, pick a short id using letters, digits, `_`, or `-`, copy the default Agent's `system_config.yaml` as the base, and create the layout described above:

```bash
mkdir -p "$TARGET/agent_state/skills" "$TARGET/agent_state/hooks" "$TARGET/agent_state/memory" "$TARGET/agent_state/tools" "$TARGET/scratchpad"
cp "$APP_DATA_DIR/agents/default_agent/agent_state/system_config.yaml" "$TARGET/agent_state/"
```

Then set the top-level `name`, `description`, and `version: 1`, set `model.thinking_level` to the resolved value, write `agent_state/AGENTS.md` (it lives under `agent_state/`, not at the agent directory root), and install only the Skills and hook packages required by the user's requirement. Do not persist the resolved provider/model pair in the Agent State.

## The embedded agent of an SDK app

An app built with the penguin-sdk skill carries its own agent inside the project (`createAgent({ root })` initializes `<app>/penguin_data/default_project/agents/default_agent/` on first run). That directory has exactly the layout described here, and the same file conventions apply to it: write the app's persona into its `agent_state/AGENTS.md` (the penguin-sdk recipe keeps the source of truth in the project's `persona.md` and copies it in during ingest), and set `name`/`description` in its `system_config.yaml` so the app is recognizable. This is how "the app becomes an expert on X": the persona lives in the embedded agent's AGENTS.md, not in application code.
