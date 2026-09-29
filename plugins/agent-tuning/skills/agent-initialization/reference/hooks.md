# Hook packages: the full contract

A hook package is `agent_state/hooks/<package_name>/`: a `hooks.json` manifest and the scripts it names. The directory name is the package's name (letters, digits, `_`, `-`) and wins over the manifest's `name`.

## `hooks.json`

```json
{
  "name": "<package_name>",
  "description": "<one line, English>",
  "description_zh": "<one line, Chinese - optional>",
  "version": "<YYYY.MM.DD.N>",
  "user_prompt": [{ "command": "prompt.mjs", "timeout": 10 }],
  "pre_tool_use": [{ "command": "guard.mjs", "timeout": 5 }],
  "stop": [{ "command": "stop.mjs", "timeout": 60 }]
}
```

- A hook point you do not use may be left out or given `[]`.
- `command` is a path relative to the package directory and must stay inside it. An entry without one is ignored.
- `timeout` is in seconds; 60 when absent.
- `version` is today's date plus a counter, `2026.09.29.1`. Raise it whenever you change the package.
- Commands of one point run in the order listed; packages run in name order.

### `trigger` (on `user_prompt` commands only)

| Value | The command runs |
| --- | --- |
| `"prompt"` (default) | On every prompt the user submits |
| `"host"` | Only when the host starts the package's own flow by name. Goal mode's start script is the shipped example; an ordinary hook never needs it |

Write `trigger` explicitly only for `"host"`. One thing to know when editing an older package: a manifest whose `version` is older than `2026.09.29.1` has its unmarked `user_prompt` commands read as `"host"`, so raise the version when you want them to run on every prompt.

## What a script receives and answers

Every script gets one JSON object on stdin with these fields, plus the ones of its point:

| Field | Meaning |
| --- | --- |
| `hook` | The point: `user_prompt`, `pre_tool_use` or `stop` |
| `session_id` | The Session's id |
| `trace_path` | Absolute path of the Trace file being written — a JSONL record of the conversation so far. Absent when the Session keeps no Trace |

stdout is one JSON object, or nothing for "no opinion". Unknown fields are dropped.

### `user_prompt`

Runs when a task starts from a message the user wrote. It does not run for messages the harness or the server injects: scheduled tasks, a `stop` hook's continuation, background-task reports, mid-run steering.

| stdin | |
| --- | --- |
| `prompt` | The user's text, with leading marker blocks (a skill invocation, an origin note) stripped |
| `scratchpad_dir` | The Session's scratchpad directory — the place for state the hook keeps between prompts |

| stdout | |
| --- | --- |
| `context` | Text for the model. It is sent as its own message right behind the user's, marked as harness-injected, and shown to the user as a collapsed card. Empty or absent adds nothing |

The context is appended after the user's message, so it never invalidates the prompt cache of the conversation before it. Keep it short: it is paid for on every prompt.

### `pre_tool_use`

Runs once per tool call, before the approval step.

| stdin | |
| --- | --- |
| `tool_name` | The tool being called, e.g. `exec_command` |
| `tool_call_id` | The call's id |
| `arguments` | The call's arguments as the raw JSON string the model wrote — parse it yourself |

| stdout | |
| --- | --- |
| `decision` | `"deny"` refuses the call and the model reads `reason`; `"allow"` approves it without asking the user; absent leaves the call to the normal approval |
| `reason` | One line for people |
| `output` | Your own record: an object of string, number or boolean values |

The first decision among all hooks wins. An `allow` never overrides the Project's command policy: a command the policy forbids stays forbidden.

### `stop`

Runs after every task: the model's final reply, or a cutoff (the user's abort, a failed request, the turn cap).

| stdout | |
| --- | --- |
| `decision` | `"continue"` starts another task with `input` as its user message; `"stop"` lets the run end |
| `input` | Required with `continue`: the next task's input text |
| `reason` | One line for people |
| `output` | Your own record: an object of string, number or boolean values |
| `subagent` | `{ "prompt": "<text>", "agent_id": "<optional>" }` — hands work to a detached background session |

The first `continue` wins. After a cutoff a `continue` is recorded but not run: the user's interruption outranks every hook. A `stop` hook that always continues never lets the agent finish — decide from state (the Trace, a file in the scratchpad), and make sure the state eventually says stop.

## Failures

A non-zero exit, stdout that is not JSON, or a timeout is a failure. The harness records it as a `hook` event carrying the error (the tail of stderr for a non-zero exit) and carries on as if the hook had no opinion. To debug a hook that seems not to fire, look for `"type":"hook"` records in the Trace file, and run the script by hand:

```bash
echo '{"hook":"stop","session_id":"test","trace_path":"/path/to/trace.jsonl"}' | node stop.mjs; echo "exit $?"
```

Check three more things when nothing happens: the agent's `hooks.enabled` is not `false`, the conversation has opened a new context since you wrote the package (see "When a change takes effect" in SKILL.md), and the session is not a subagent's — child sessions run no hooks.

## Converting hooks from Claude Code

| Claude Code | Here |
| --- | --- |
| `UserPromptSubmit` | `user_prompt` — print `{ "context": … }` instead of plain text |
| `PreToolUse` | `pre_tool_use` — `permissionDecision` becomes `decision`; filter on `tool_name` inside the script, there is no `matcher` |
| `Stop` | `stop` — `{"decision":"block","reason":…}` becomes `{"decision":"continue","input":…}` |
| `PostToolUse`, `SessionStart`, `Notification`, others | No counterpart. Say so rather than approximating |

A Claude Code hook is a shell command; here a command is a Node script. Wrap a shell command with `node:child_process` (`execFileSync`) when you need one, and keep the JSON on stdout yours.
