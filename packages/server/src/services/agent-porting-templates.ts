/**
 * The documents an Agent bundle ships beside `penguin-agent.json`: an integration guide
 * written for a coding agent, the four server API calls that run this Agent with their
 * shapes, and three runnable clients. Everything is rendered from the portable definition
 * with the Project and Agent ids filled in; the server URL stays a placeholder because the
 * bundle is meant to be read on another machine.
 */
import type { PortableAgentDefinition } from "../api/types.js";

/** The local server's default listen address; every example reads PENGUIN_SERVER first. */
const DEFAULT_SERVER = "http://localhost:7364";

/** Markdown table rows, or one italic line when there is nothing to list. */
function rows(lines: string[], empty: string): string {
  return lines.length > 0 ? lines.join("\n") : `| _${empty}_ | |`;
}

function modelLine(definition: PortableAgentDefinition): string {
  const parts: string[] = [];
  if (definition.model?.thinkingLevel !== undefined) {
    parts.push(`thinking level \`${definition.model.thinkingLevel}\``);
  }
  if (definition.model?.maxTokens !== undefined) {
    parts.push(`max_tokens \`${definition.model.maxTokens}\``);
  }
  if (definition.model?.timeoutMs !== undefined) {
    parts.push(`idle timeout \`${definition.model.timeoutMs}\` ms`);
  }
  return parts.length > 0
    ? `${parts.join(", ")}; the model itself is the Project's default (or the one named per Session)`
    : "the Project's default model; a Session may name another one";
}

export function renderReadme(definition: PortableAgentDefinition): string {
  const projectId = definition.source?.projectId ?? "<project_id>";
  const agentId = definition.source?.agentId ?? definition.id;
  const skillRows = definition.skills.map(
    (s) =>
      `| Skill | \`${s.name}\` | ${s.description ?? ""}${s.version ? ` (v${s.version})` : ""} |`,
  );
  const hookRows = definition.hooks.map(
    (h) =>
      `| Hook package | \`${h.name}\` | ${h.description ?? ""}${h.version ? ` (v${h.version})` : ""} |`,
  );
  const toolRows = (definition.tools?.builtin ?? []).map((t) => `| Built-in tool | \`${t}\` | |`);
  const mcpRows = (definition.mcpServers ?? []).map(
    (m) =>
      `| MCP Server | \`${m.name}\` | ${String((m.config as { transport?: unknown }).transport ?? "stdio")} |`,
  );
  const vaultKeys = definition.vaultKeys ?? [];
  // The same MCP note either way: it is the one caveat a reader of this bundle has to act on,
  // and it must not read as an afterthought only agents with vault keys get.
  const mcpNote =
    "MCP `env` / `headers` entries whose names look like credentials were blanked in " +
    "`penguin-agent.json` and need filling in. That blanking is the whole of the redaction — " +
    "a secret written anywhere else in an MCP entry (a token in a `url` query string, a key " +
    "in stdio `args`) is still in the file, so read `mcpServers` before passing this bundle on.";
  const vaultSection =
    vaultKeys.length > 0
      ? `The agent expects these environment variables from its vault: ${vaultKeys.map((k) => `\`${k}\``).join(", ")}. Values never travel in a bundle — set them on the agent's Vault tab in the Web App, or with \`penguin config vault set --agent-id ${agentId} --key <NAME> --value <value>\`. ${mcpNote}`
      : `The agent declares no vault keys. ${mcpNote}`;

  return `# ${definition.name} — integration guide

${definition.description ?? "_No description._"}

This bundle was exported from PenguinHarness (Project \`${projectId}\`, Agent \`${agentId}\`${definition.source ? `, Agent State v${definition.source.version}` : ""}) on ${definition.exportedAt}. It is written for a coding agent (or a person) integrating the agent into another system: what the agent is, how to call it over the PenguinHarness server API, and how to run it from the CLI.

## What is in the bundle

| Path | Contents |
| --- | --- |
| \`penguin-agent.json\` | The portable definition: name, instructions (\`prompt\`), skills, hook packages, built-in tools, MCP Servers, model preferences, vault key names |
| \`skills/<name>/\` | The installed skills, one directory each (\`SKILL.md\` plus its reference files) |
| \`hooks/<name>/\` | The installed hook packages (\`hooks.json\` plus scripts) |
| \`api/ENDPOINTS.md\` | The four server API calls that run this agent, with request and response shapes |
| \`examples/curl.sh\`, \`examples/client.py\`, \`examples/client.ts\` | Runnable clients: create a Session, send a task, print the final answer |

Not included: vault values, memory, Traces, scheduled tasks and Agent State snapshots. To move all of those, use the snapshot export on the agent's settings page instead — a snapshot restores state, this bundle ports an agent.

## The agent

- Id \`${agentId}\` in Project \`${projectId}\`; display name "${definition.name}".
- Instructions: the \`prompt\` field of \`penguin-agent.json\` (the agent's AGENTS.md).
- Model: ${modelLine(definition)}.

## Calling the agent over the server API

The PenguinHarness server is the API: every call is an HTTP request to the server that hosts the agent. A local install listens on \`${DEFAULT_SERVER}\` (\`penguin server\` / \`penguin web\`; the desktop app runs the same server). The examples read the base URL from \`PENGUIN_SERVER\` and the token from \`PENGUIN_API_TOKEN\`.

Authentication is \`Authorization: Bearer <token>\`. On the machine that runs the server the token is the file \`<data root>/api-token\` (\`~/.penguin/data/api-token\` by default; minted fresh at every server boot), and a session the server runs hands it to its tool subprocesses as \`PENGUIN_API_TOKEN\`. From elsewhere, sign in with \`penguin auth login --server <url>\`, or use the browser login cookie from \`POST /api/auth/login\` (\`{ "username", "password" }\`).

The four calls (full shapes in \`api/ENDPOINTS.md\`):

1. **Create a Session** — \`POST /api/projects/${projectId}/agents/${agentId}/sessions\` with \`{ "approvalMode": "allow-all" }\` → 201 \`{ "session": { "sessionId", ... } }\`. Add \`"workspace": "<absolute directory on the server>"\` to work in a directory; omitted, the Session gets a temporary Workspace. \`allow-all\` matters for an unattended caller: under \`always-ask\` the run would wait for a human to approve tool calls in the Web App.
2. **Send a task** — \`POST /api/sessions/<sessionId>/tasks\` with \`{ "input": [{ "type": "text", "text": "..." }] }\` → 202. One task runs at a time per Session; \`"queueIfBusy": true\` queues the next one instead of a 409.
3. **Read the answer**, either way:
   - Stream: \`GET /api/sessions/<sessionId>/stream\` (Server-Sent Events; connect before posting the task). Unnamed events carry OmniMessage JSON — a \`model_msg\` whose payload is \`{ "type": "text", "role": "assistant", "text" }\` is a complete reply, and \`partial_text\` payloads stream its deltas before it. Events named \`server_event\` carry \`{ "type": "task_state", "state": "running" | "idle" }\`; \`idle\` after \`running\` means the task is done.
   - Poll: \`GET /api/sessions/<sessionId>\` until \`session.status\` is \`"idle"\`, then \`GET /api/sessions/<sessionId>/messages\` and take the last \`model_msg\` whose payload is a \`text\` with role \`assistant\`.
4. **Continue or finish** — post another task to the same Session to keep the context, create a new Session per independent job, or \`DELETE /api/sessions/<sessionId>\` when its Trace is no longer needed.

## Running it from the CLI

\`\`\`bash
penguin run -m "..." --agent-id ${agentId} --project-id ${projectId}      # one task, rendered in the terminal
penguin run -m "..." --agent-id ${agentId} --project-id ${projectId} --background   # prints the session id and returns
penguin chat --agent-id ${agentId} --project-id ${projectId}              # interactive
penguin input <session_id> -m "..."                                        # follow up in a session; without -m, print its latest reply
penguin logs <session_id>                                                  # the transcript
\`\`\`

\`--server <url>\` targets a remote server (with \`PENGUIN_API_TOKEN\` set); without it the CLI attaches to the local server, starting one if needed.

## Skills, hooks and tools

| Kind | Name | Notes |
| --- | --- | --- |
${rows([...skillRows, ...hookRows, ...toolRows, ...mcpRows], "nothing installed beyond the defaults")}

Skills are read by the agent on demand from \`agent_state/skills/<name>/SKILL.md\`; a request can name them explicitly by starting the task text with \`[use_skills]\\nskills: <name>\`.

## Vault keys

${vaultSection}

## Limits

- One running task per Session; run parallel work in parallel Sessions.
- The Workspace is a directory on the server's machine, and tool subprocesses run there.
- An unattended caller must use \`allow-all\` or \`read-only\` approval.
- Long tasks: stream, or poll with a bound; the CLI's \`--timeout\` and \`--background\` cover both.
- Costs land in the Project's usage (\`GET /api/projects/${projectId}/usage\`, \`penguin cost\`).

## Importing this bundle into another PenguinHarness

\`penguin agent import ${agentId}-export.zip [--agent-id <new id>] [--project-id <project>]\`, or the Agents page's **Import agent** button. The import creates the agent with these instructions, skills, hooks, tools and MCP entries; vault values are set by hand afterwards.
`;
}

export function renderEndpoints(definition: PortableAgentDefinition): string {
  const projectId = definition.source?.projectId ?? "<project_id>";
  const agentId = definition.source?.agentId ?? definition.id;
  return `# Server API calls for agent \`${agentId}\`

Base URL: \`$PENGUIN_SERVER\` (\`${DEFAULT_SERVER}\` for a local install). Every request carries \`Authorization: Bearer $PENGUIN_API_TOKEN\`; JSON bodies use \`Content-Type: application/json\`. Errors are \`{ "error": { "code", "message" } }\` with a 4xx/5xx status.

## 1. Create a Session

\`\`\`http
POST /api/projects/${projectId}/agents/${agentId}/sessions
\`\`\`

Request (every field optional):

\`\`\`json
{ "workspace": "/absolute/dir/on/the/server", "approvalMode": "allow-all", "modelId": "<upstream id>", "provider": "<provider group>" }
\`\`\`

\`modelId\` and \`provider\` go together or not at all (the Project's default model otherwise). \`approvalMode\` is \`allow-all\` (default), \`read-only\`, \`always-ask\` or \`deny-all\`.

Response \`201\`:

\`\`\`json
{ "session": { "sessionId": "session-2026-09-02-10-00-00-1a2b3c4d", "projectId": "${projectId}", "agentId": "${agentId}", "status": "idle", "workspace": "...", "provider": "...", "modelId": "...", "approvalMode": "allow-all", "createdAt": "...", "lastActiveAt": "..." } }
\`\`\`

## 2. Send a task

\`\`\`http
POST /api/sessions/<sessionId>/tasks
\`\`\`

\`\`\`json
{ "input": [{ "type": "text", "text": "..." }], "queueIfBusy": false }
\`\`\`

Input parts may also be \`{ "type": "image_url", "imageUrl": "data:image/png;base64,..." }\`. Response \`202\` \`{ "sessionId": "...", "queued": false }\` — the returned \`sessionId\` is the one to use from here on. \`409\` when a task is already running and \`queueIfBusy\` is not set.

## 3a. Stream the run

\`\`\`http
GET /api/sessions/<sessionId>/stream
Accept: text/event-stream
\`\`\`

The first frame is a \`server_event\` snapshot \`{ "type": "task_state", "state": "idle" | "running" | "compacting" }\`. Then, per event:

- unnamed events: one OmniMessage \`{ "timestamp", "type": "model_msg" | "event_msg" | "session_meta", "payload": { ... } }\` per line of \`data:\`. A complete assistant reply is \`type: "model_msg"\` with payload \`{ "type": "text", "role": "assistant", "text": "..." }\`; \`{ "type": "partial_text", "event_type": "delta", "text": "..." }\` payloads stream its chunks first; tool calls arrive as \`tool_call\` / \`tool_call_output\` payloads.
- \`event: server_event\` frames: \`task_state\` (the run flipping between \`running\` and \`idle\`), \`approval_request\` (only under \`always-ask\` / \`read-only\`), \`session_title\`, \`resync_required\` (re-fetch \`/messages\`).

Reconnect with \`Last-Event-ID\` to replay the gap; a heartbeat comment arrives every 20 seconds.

## 3b. Poll instead

\`\`\`http
GET /api/sessions/<sessionId>            → { "session": { "status": "idle" | "running" | "compacting", ... } }
GET /api/sessions/<sessionId>/messages   → { "messages": [ OmniMessage, ... ] }
\`\`\`

The final answer is the last message with \`type == "model_msg"\` and payload \`type == "text"\`, \`role == "assistant"\`.

## 4. Follow up, steer, stop

\`\`\`http
POST   /api/sessions/<sessionId>/tasks      # the next task in the same context
POST   /api/sessions/<sessionId>/steer      # { "input": [...] } delivered mid-run (409 not_running when idle)
POST   /api/sessions/<sessionId>/abort      # interrupt the current task
DELETE /api/sessions/<sessionId>            # delete the Session and its Trace
\`\`\`
`;
}

export function renderCurlExample(definition: PortableAgentDefinition): string {
  const projectId = definition.source?.projectId ?? "<project_id>";
  const agentId = definition.source?.agentId ?? definition.id;
  return `#!/usr/bin/env bash
# Create a Session for the agent, send one task, wait for it to finish, print the final answer.
# Needs curl and jq. Env: PENGUIN_SERVER (default ${DEFAULT_SERVER}), PENGUIN_API_TOKEN (see README.md).
set -euo pipefail

SERVER="\${PENGUIN_SERVER:-${DEFAULT_SERVER}}"
TOKEN="\${PENGUIN_API_TOKEN:?set PENGUIN_API_TOKEN (see README.md)}"
PROJECT_ID="${projectId}"
AGENT_ID="${agentId}"
PROMPT="\${1:-Introduce yourself in one paragraph.}"
auth=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

SESSION_ID=$(curl -sS --fail "\${auth[@]}" -X POST \\
  "$SERVER/api/projects/$PROJECT_ID/agents/$AGENT_ID/sessions" \\
  -d '{"approvalMode":"allow-all"}' | jq -r .session.sessionId)
echo "session: $SESSION_ID" >&2

curl -sS --fail "\${auth[@]}" -X POST "$SERVER/api/sessions/$SESSION_ID/tasks" \\
  -d "$(jq -cn --arg t "$PROMPT" '{input:[{type:"text",text:$t}]}')" >/dev/null

# Poll until the run ends, then print the last complete assistant reply.
while sleep 1; do
  status=$(curl -sS --fail "\${auth[@]}" "$SERVER/api/sessions/$SESSION_ID" | jq -r .session.status)
  [ "$status" = "idle" ] && break
done
curl -sS --fail "\${auth[@]}" "$SERVER/api/sessions/$SESSION_ID/messages" \\
  | jq -r '[.messages[] | select(.type == "model_msg" and .payload.type == "text" and .payload.role == "assistant")] | last | .payload.text'
`;
}

export function renderPythonExample(definition: PortableAgentDefinition): string {
  const projectId = definition.source?.projectId ?? "<project_id>";
  const agentId = definition.source?.agentId ?? definition.id;
  return `#!/usr/bin/env python3
"""Create a Session for the agent, send one task, wait for it to finish and print the final answer.

Standard library only. Env: PENGUIN_SERVER (default ${DEFAULT_SERVER}), PENGUIN_API_TOKEN (see README.md).
"""
import json
import os
import sys
import time
import urllib.request

SERVER = os.environ.get("PENGUIN_SERVER", "${DEFAULT_SERVER}").rstrip("/")
TOKEN = os.environ.get("PENGUIN_API_TOKEN") or sys.exit("set PENGUIN_API_TOKEN (see README.md)")
PROJECT_ID = "${projectId}"
AGENT_ID = "${agentId}"


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        SERVER + path,
        data=data,
        method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as res:
        return json.load(res) if res.status != 204 else None


def run(prompt):
    created = call("POST", f"/api/projects/{PROJECT_ID}/agents/{AGENT_ID}/sessions", {"approvalMode": "allow-all"})
    session_id = created["session"]["sessionId"]
    call("POST", f"/api/sessions/{session_id}/tasks", {"input": [{"type": "text", "text": prompt}]})
    while True:
        time.sleep(1)
        if call("GET", f"/api/sessions/{session_id}")["session"]["status"] == "idle":
            break
    messages = call("GET", f"/api/sessions/{session_id}/messages")["messages"]
    answers = [
        m["payload"]["text"]
        for m in messages
        if m["type"] == "model_msg"
        and m["payload"].get("type") == "text"
        and m["payload"].get("role") == "assistant"
    ]
    return session_id, (answers[-1] if answers else "")


if __name__ == "__main__":
    prompt = " ".join(sys.argv[1:]) or "Introduce yourself in one paragraph."
    session_id, answer = run(prompt)
    print("session: " + session_id, file=sys.stderr)
    print(answer)
`;
}

export function renderTsExample(definition: PortableAgentDefinition): string {
  const projectId = definition.source?.projectId ?? "<project_id>";
  const agentId = definition.source?.agentId ?? definition.id;
  return `#!/usr/bin/env node
// Create a Session for the agent, send one task, stream the reply over SSE and print the final answer.
// Node 24, no dependencies (run with \`node --experimental-strip-types client.ts\` or compile with tsc).
// Env: PENGUIN_SERVER (default ${DEFAULT_SERVER}), PENGUIN_API_TOKEN (see README.md).

const SERVER = (process.env.PENGUIN_SERVER ?? "${DEFAULT_SERVER}").replace(/\\/$/, "");
const TOKEN = process.env.PENGUIN_API_TOKEN ?? "";
if (TOKEN === "") {
  console.error("set PENGUIN_API_TOKEN (see README.md)");
  process.exit(1);
}
const PROJECT_ID = "${projectId}";
const AGENT_ID = "${agentId}";
const headers = { authorization: \`Bearer \${TOKEN}\`, "content-type": "application/json" };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(\`\${SERVER}\${path}\`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(\`\${method} \${path} -> \${res.status} \${await res.text()}\`);
  return (await res.json()) as T;
}

interface Frame {
  event?: string;
  data: string;
}

/** Opens the Session's SSE stream (connected before returning) and yields its frames. */
async function openStream(path: string, signal: AbortSignal): Promise<AsyncGenerator<Frame>> {
  const res = await fetch(\`\${SERVER}\${path}\`, {
    headers: { authorization: headers.authorization, accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || res.body === null) throw new Error(\`GET \${path} -> \${res.status}\`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  async function* frames(): AsyncGenerator<Frame> {
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf("\\n\\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event: string | undefined;
        const data: string[] = [];
        for (const line of frame.split("\\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length > 0) yield { event, data: data.join("\\n") };
      }
    }
  }
  return frames();
}

async function run(prompt: string): Promise<{ sessionId: string; answer: string }> {
  const { session } = await call<{ session: { sessionId: string } }>(
    "POST",
    \`/api/projects/\${PROJECT_ID}/agents/\${AGENT_ID}/sessions\`,
    { approvalMode: "allow-all" },
  );
  const controller = new AbortController();
  // Subscribe before posting so no event of the task is missed; the first frame is the idle snapshot.
  const frames = await openStream(\`/api/sessions/\${session.sessionId}/stream\`, controller.signal);
  await call("POST", \`/api/sessions/\${session.sessionId}/tasks\`, {
    input: [{ type: "text", text: prompt }],
  });
  let started = false;
  let answer = "";
  for await (const frame of frames) {
    const msg = JSON.parse(frame.data) as {
      type?: string;
      state?: string;
      payload?: { type?: string; role?: string; event_type?: string; text?: string };
    };
    if (frame.event === "server_event") {
      if (msg.type === "task_state" && msg.state === "running") started = true;
      else if (msg.type === "task_state" && msg.state === "idle" && started) break;
      continue;
    }
    if (msg.type !== "model_msg" || msg.payload === undefined) continue;
    if (msg.payload.type === "partial_text" && msg.payload.event_type === "delta") {
      process.stdout.write(msg.payload.text ?? "");
    } else if (msg.payload.type === "text" && msg.payload.role === "assistant") {
      answer = msg.payload.text ?? "";
    }
  }
  controller.abort();
  return { sessionId: session.sessionId, answer };
}

const prompt = process.argv.slice(2).join(" ") || "Introduce yourself in one paragraph.";
run(prompt).then(({ sessionId, answer }) => {
  process.stdout.write("\\n");
  console.error(\`session: \${sessionId}\`);
  console.log(answer);
});
`;
}

/** Every document of a bundle, keyed by its path inside the zip. */
export function renderBundleDocs(definition: PortableAgentDefinition): Record<string, string> {
  return {
    "README.md": renderReadme(definition),
    "api/ENDPOINTS.md": renderEndpoints(definition),
    "examples/curl.sh": renderCurlExample(definition),
    "examples/client.py": renderPythonExample(definition),
    "examples/client.ts": renderTsExample(definition),
  };
}
