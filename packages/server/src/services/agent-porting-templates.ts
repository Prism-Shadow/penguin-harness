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

// ---------------------------------------------------------------------------
// Docker export
// ---------------------------------------------------------------------------

/**
 * Environment the container reads. The model triple is required — a PenguinHarness install
 * with no model configured starts but cannot answer — and each vault key the definition
 * declares is listed too, so the operator sees everything that has to be filled in in one file
 * rather than discovering it from a failing run.
 */
function dockerEnvNames(definition: PortableAgentDefinition, pin: boolean): string[] {
  return [
    "PENGUIN_MODEL_PROVIDER",
    "PENGUIN_MODEL_ID",
    "PENGUIN_MODEL_API_KEY",
    "PENGUIN_MODEL_BASE_URL",
    "PENGUIN_ADMIN_PASSWORD",
    // A pinned container is a deployment, so it is the one that seeds the people who will use it.
    ...(pin ? ["PENGUIN_USERS"] : []),
    ...(definition.vaultKeys ?? []),
  ];
}

/**
 * The image, in two stages.
 *
 * The build stage is not an optimization: `node-pty` publishes prebuilt bindings for macOS and
 * Windows only, so on Linux its install script falls through to `node-gyp rebuild`, which needs
 * python3, make and a C++ compiler. Installing the CLI on a bare slim image therefore fails.
 * Compiling in a builder stage and copying the finished npm prefix keeps that toolchain out of
 * the image the agent's own tools run in; both stages share a base, so the native binding built
 * there loads here.
 *
 * `latest` rather than a pinned version: the bundle cannot know which release the reader wants
 * to run, and a stale pin ages worse than a documented ARG they can set.
 *
 * Once an official PenguinHarness image exists this collapses to a FROM line plus the bundle
 * COPY, and the base image, the toolchain and the unprivileged user live in one place instead
 * of in every exported bundle.
 */
function renderDockerfile(pin: boolean): string {
  return `# syntax=docker/dockerfile:1
# PenguinHarness agent container. Build:  docker build --build-arg PENGUIN_VERSION=<version> -t <name> .
ARG PENGUIN_VERSION=latest

# node-pty ships no Linux prebuild, so installing the CLI compiles it with node-gyp. Build it
# once here; the runtime image below carries the result, not the compiler.
FROM node:24-slim AS builder
RUN apt-get update \\
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \\
  && rm -rf /var/lib/apt/lists/*
ARG PENGUIN_VERSION
RUN npm install -g --prefix /opt/penguin @prismshadow/penguin-cli@\${PENGUIN_VERSION}

FROM node:24-slim

# git and ca-certificates: agents routinely clone and reach HTTPS endpoints from their tools.
RUN apt-get update \\
  && apt-get install -y --no-install-recommends ca-certificates git curl \\
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/penguin /opt/penguin
ENV PATH="/opt/penguin/bin:\${PATH}"

# The data root holds the Project config, the agent and every Trace: mount it to keep them.
ENV PENGUIN_HOME=/data
ENV PORT=7364
ENV HOST=0.0.0.0
VOLUME ["/data"]

WORKDIR /bundle
COPY penguin-agent.json ./penguin-agent.json
COPY skills ./skills
COPY hooks ./hooks
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 7364
${
  pin
    ? `# No USER here on purpose: the entrypoint starts as root to lock the agent's definition
# files, then drops to \`node\` for the server itself. See entrypoint.sh.
`
    : ""
}ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
`;
}

/**
 * First boot configures the model and imports the agent, then the server runs in the
 * foreground. The import goes through the running server (that route is the only importer),
 * so the script starts it, waits for it to answer, imports, and then hands the process the
 * terminal signals by waiting on it. A sentinel keeps restarts from re-importing — the second
 * attempt would answer 409 anyway, but a container that logs an error on every restart reads
 * as broken.
 */
function renderEntrypoint(definition: PortableAgentDefinition, pin: boolean): string {
  if (pin) return renderPinnedEntrypoint(definition);
  return `#!/usr/bin/env bash
set -euo pipefail

: "\${PENGUIN_HOME:=/data}"
: "\${PORT:=7364}"
: "\${HOST:=0.0.0.0}"
SENTINEL="\$PENGUIN_HOME/.agent-imported"

if [ -z "\${PENGUIN_MODEL_API_KEY:-}" ]; then
  echo "PENGUIN_MODEL_API_KEY is unset — the agent will start but cannot call a model." >&2
fi

# The admin password is pinned so the API is reachable without the first-login link; without
# one the server seeds a random password and prints a claim link instead.
if [ -n "\${PENGUIN_ADMIN_PASSWORD:-}" ]; then
  export PENGUIN_SEED_ADMIN_PASSWORD="\$PENGUIN_ADMIN_PASSWORD"
fi

if [ ! -f "\$SENTINEL" ]; then
  if [ -n "\${PENGUIN_MODEL_API_KEY:-}" ]; then
    # Model config is written straight to the data root, so it is in place before the server
    # (and therefore the agent) ever starts.
    penguin config model add \\
      --provider "\${PENGUIN_MODEL_PROVIDER:-custom}" \\
      --model-id "\${PENGUIN_MODEL_ID:?PENGUIN_MODEL_ID is required}" \\
      --api-key "\$PENGUIN_MODEL_API_KEY" \\
      \${PENGUIN_MODEL_BASE_URL:+--base-url "\$PENGUIN_MODEL_BASE_URL"} \\
      --root "\$PENGUIN_HOME" \\
      --set-default
  fi
fi

penguin server --host "\$HOST" --port "\$PORT" &
SERVER_PID=\$!
trap 'kill -TERM "\$SERVER_PID" 2>/dev/null || true; wait "\$SERVER_PID" 2>/dev/null || true' TERM INT

for _ in \$(seq 1 60); do
  curl -sf "http://127.0.0.1:\$PORT/api/install" >/dev/null 2>&1 && break
  sleep 1
done

if [ ! -f "\$SENTINEL" ]; then
  echo "Importing agent ${definition.id} …"
  cd /bundle
  penguin agent import penguin-agent.json \\
    --agent-id "\${PENGUIN_AGENT_ID:-${definition.id}}" \\
    --project-id "\${PENGUIN_PROJECT_ID:-default_project}" \\
    --server "http://127.0.0.1:\$PORT"
  touch "\$SENTINEL"
fi

wait "\$SERVER_PID"
`;
}

/**
 * The pinned variant, in three phases.
 *
 * The ordering problem it solves: importing the agent is a write through the running server,
 * and that is precisely the route a pinned server refuses. So first boot runs its own
 * short-lived server bound to loopback — unreachable from outside the container — and only the
 * final exec carries PENGUIN_PINNED_AGENT. Nothing in the server special-cases the import.
 *
 * The lock in phase 2 is the half the route guards cannot cover: the model is told where its
 * Agent State lives and is invited to edit it, so a definition that is only protected by HTTP
 * is not protected at all. Root owns the definition files and the server does not run as root.
 */
function renderPinnedEntrypoint(definition: PortableAgentDefinition): string {
  return `#!/usr/bin/env bash
set -euo pipefail

: "\${PENGUIN_HOME:=/data}"
: "\${PORT:=7364}"
: "\${HOST:=0.0.0.0}"
AGENT_ID="\${PENGUIN_AGENT_ID:-${definition.id}}"
PROJECT_ID="\${PENGUIN_PROJECT_ID:-default_project}"
SENTINEL="\$PENGUIN_HOME/.agent-imported"
STATE="\$PENGUIN_HOME/\$PROJECT_ID/agents/\$AGENT_ID/agent_state"

# This script starts as root so it can lock the agent's definition below; the server never does,
# because root walks straight through the file permissions that are the whole of that lock.
if ! command -v setpriv >/dev/null 2>&1; then
  echo "setpriv (util-linux) is missing; refusing to run the pinned server as root." >&2
  exit 1
fi
as_node() { setpriv --reuid=node --regid=node --init-groups "\$@"; }

if [ -z "\${PENGUIN_MODEL_API_KEY:-}" ]; then
  echo "PENGUIN_MODEL_API_KEY is unset — the agent will start but cannot call a model." >&2
fi

# The admin password is pinned so the API is reachable without the first-login link; without
# one the server seeds a random password and prints a claim link instead.
if [ -n "\${PENGUIN_ADMIN_PASSWORD:-}" ]; then
  export PENGUIN_SEED_ADMIN_PASSWORD="\$PENGUIN_ADMIN_PASSWORD"
fi

# A first-boot server, on loopback only: setup has to talk to a running server, and nothing
# outside the container may reach one that is still accepting writes to the definition.
#
# Addressed as localhost, not 127.0.0.1: a loopback bind canonicalizes the App onto localhost
# and serves Workspace previews from 127.0.0.1, so the API answers 401 there. The listener is
# still 127.0.0.1 (plus its ::1 companion) — only the Host header differs.
start_local_server() {
  as_node env PENGUIN_PINNED_AGENT="\$1" penguin server --host 127.0.0.1 --port "\$PORT" &
  SERVER_PID=\$!
  trap 'kill -TERM "\$SERVER_PID" 2>/dev/null || true' TERM INT
  for _ in \$(seq 1 60); do
    curl -sf "http://localhost:\$PORT/api/install" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "The server did not answer on localhost:\$PORT within 60s." >&2
  return 1
}

stop_local_server() {
  kill -TERM "\$SERVER_PID" 2>/dev/null || true
  wait "\$SERVER_PID" 2>/dev/null || true
  trap - TERM INT
}

# ---- Phase 1: first boot ----------------------------------------------------------------
if [ ! -f "\$SENTINEL" ]; then
  # Everything the server writes belongs to node; only the definition files are root's, and
  # phase 2 below takes those back after they exist.
  mkdir -p "\$PENGUIN_HOME"
  chown -R node:node "\$PENGUIN_HOME"

  if [ -n "\${PENGUIN_MODEL_API_KEY:-}" ]; then
    # Model config is written straight to the data root, so it is in place before the server
    # (and therefore the agent) ever starts.
    as_node penguin config model add \\
      --provider "\${PENGUIN_MODEL_PROVIDER:-custom}" \\
      --model-id "\${PENGUIN_MODEL_ID:?PENGUIN_MODEL_ID is required}" \\
      --api-key "\$PENGUIN_MODEL_API_KEY" \\
      \${PENGUIN_MODEL_BASE_URL:+--base-url "\$PENGUIN_MODEL_BASE_URL"} \\
      --root "\$PENGUIN_HOME" \\
      --set-default
  fi

  # Unpinned, deliberately: this is the one window in which the import route answers.
  echo "Importing agent ${definition.id} …"
  start_local_server ""
  cd /bundle
  as_node penguin agent import penguin-agent.json \\
    --agent-id "\$AGENT_ID" \\
    --project-id "\$PROJECT_ID" \\
    --server "http://localhost:\$PORT"
  stop_local_server

  # Extra accounts, pinned this time: an unpinned server hands a new user a project of their
  # own, which would come with a second agent. Best-effort — a name already taken or a password
  # under 8 characters is reported and skipped rather than failing the boot.
  if [ -n "\${PENGUIN_USERS:-}" ]; then
    start_local_server "\$PROJECT_ID/\$AGENT_ID"
    API_TOKEN="\$(cat "\$PENGUIN_HOME/api-token")"
    printf '%s\\n' "\$PENGUIN_USERS" | tr ',' '\\n' | while IFS=':' read -r name password; do
      [ -n "\$name" ] || continue
      echo "Creating user \$name …"
      # node builds the body so a password containing a quote or a backslash stays intact.
      body="\$(node -e 'process.stdout.write(JSON.stringify({userId:process.argv[1],password:process.argv[2]}))' "\$name" "\$password")"
      curl -sSf -X POST "http://localhost:\$PORT/api/admin/users" \\
        -H "Authorization: Bearer \$API_TOKEN" \\
        -H "Content-Type: application/json" \\
        --data "\$body" -o /dev/null \\
        || echo "Could not create user \$name; add it under Settings → Users." >&2
    done
    stop_local_server
  fi

  as_node touch "\$SENTINEL"
fi

# ---- Phase 2: lock the definition (every boot, idempotent) ------------------------------
# The route guards stop people reaching the definition through the API; this stops the agent's
# own shell. Definition files become root-owned and unwritable, and the state directory keeps
# the sticky bit with group write, so node can still create memory scopes under it but can
# neither unlink nor rename what root owns. memory/ and .vault.toml stay node's: they are
# runtime data, not definition.
mkdir -p "\$STATE/schedule"
for entry in AGENTS.md system_config.yaml skills hooks tools schedule; do
  [ -e "\$STATE/\$entry" ] || continue
  chown -R root:root "\$STATE/\$entry"
  chmod -R a-w "\$STATE/\$entry"
done
chown root:node "\$STATE"
chmod 1775 "\$STATE"

# ---- Phase 3: the pinned server ---------------------------------------------------------
exec setpriv --reuid=node --regid=node --init-groups \\
  env PENGUIN_PINNED_AGENT="\$PROJECT_ID/\$AGENT_ID" \\
  penguin server --host "\$HOST" --port "\$PORT"
`;
}

function renderCompose(definition: PortableAgentDefinition): string {
  // No per-key env here: `env_file` already loads .env, and listing the vault keys twice
  // would let the two drift.
  return `services:
  ${definition.id}:
    build:
      context: .
      args:
        PENGUIN_VERSION: \${PENGUIN_VERSION:-latest}
    env_file: .env
    ports:
      - "\${PORT:-7364}:7364"
    volumes:
      # The data root: Project config, the agent and its Traces. Drop this and every run
      # starts from an empty install that re-imports the agent.
      - penguin-data:/data
    restart: unless-stopped

volumes:
  penguin-data:
`;
}

function renderEnvExample(definition: PortableAgentDefinition, pin: boolean): string {
  const vault = (definition.vaultKeys ?? []).map(
    (k) => `# ${k} — read by the agent's tools from its vault.\n${k}=`,
  );
  return `# Model the agent runs on. The provider group and the upstream model id are a pair, and
# an OpenAI-compatible endpoint also needs PENGUIN_MODEL_BASE_URL.
PENGUIN_MODEL_PROVIDER=
PENGUIN_MODEL_ID=
PENGUIN_MODEL_API_KEY=
PENGUIN_MODEL_BASE_URL=

# Pins the built-in admin's password so the API is reachable without the first-login link.
PENGUIN_ADMIN_PASSWORD=
${
  pin
    ? `
# Accounts created on first boot, \`name:password\` separated by commas (passwords are at least
# 8 characters and must contain no comma or colon). They become members of the pinned agent's
# Project; the admin can add more later under Settings → Users.
PENGUIN_USERS=
`
    : ""
}
# Host port the container is published on.
PORT=7364
${vault.length > 0 ? `\n${vault.join("\n")}\n` : ""}`;
}

function renderDockerReadme(definition: PortableAgentDefinition, pin: boolean): string {
  const vaultKeys = definition.vaultKeys ?? [];
  return `# ${definition.name} — running in a container

This bundle runs the agent as a self-contained PenguinHarness install: the container brings up
the server, imports \`${definition.id}\` on first boot, and serves the same HTTP API a local
install does. Exported ${definition.exportedAt}.
${
  pin
    ? `
This is a **pinned** bundle: the server it starts serves \`${definition.id}\` and nothing else,
and refuses to create, import, delete or redefine any agent. See "What pinned means" below.
`
    : ""
}
## Run it

\`\`\`bash
cp .env.example .env    # fill in the model provider, id and API key
docker compose up --build
\`\`\`

The API is then on \`http://localhost:\${PORT:-7364}\`, signed in as \`admin\` with
\`PENGUIN_ADMIN_PASSWORD\`. \`api/ENDPOINTS.md\` and \`examples/\` in the API bundle show how to
drive it; the endpoints are identical here.

## What the first boot does

${
  pin
    ? `1. Writes the model configuration into the data root from the environment.
2. Starts a server on loopback only, imports \`penguin-agent.json\` with the bundled \`skills/\`
   and \`hooks/\`, and stops it again. This window is unpinned on purpose — importing an agent
   is exactly what a pinned server refuses — and it is never reachable from outside the
   container.
3. Creates the accounts listed in \`PENGUIN_USERS\`, if any, against a pinned server, so each
   one becomes a member of this agent's Project rather than being given a project of their own.
4. Makes the agent's definition files root-owned and read-only (see below).
5. Drops a sentinel in the data root so restarts skip all of the above.
6. Starts the real server as the unprivileged \`node\` user with
   \`PENGUIN_PINNED_AGENT=default_project/${definition.id}\`.`
    : `1. Writes the model configuration into the data root from the environment.
2. Starts the server.
3. Imports \`penguin-agent.json\` together with the bundled \`skills/\` and \`hooks/\`.
4. Drops a sentinel in the data root so restarts skip the import.`
}

The data root is the \`penguin-data\` volume. Removing it resets the install, and the next
start imports the agent again.
${
  pin
    ? `
## What pinned means

The server refuses, for everyone including \`admin\`, with \`403 agent_pinned\`: creating,
importing or deleting an agent; writing its config, updating its kernel or resetting it;
inserting a prompt-template placeholder; installing or removing a skill, plugin or hook;
importing an Agent State snapshot; creating, editing or deleting a schedule; and creating or
deleting a Project. \`GET /api/me\` reports \`pinnedAgent\`, and the Web App hides what the
server would refuse. Everything else is unchanged: chatting, approvals, files, Traces, memory,
the vault, Project members and user management all work as they do on any install.

Two layers do this, and they cover different things:

- **The route guards above** stop people reaching the definition through the API or the Web App.
  They cannot stop the agent itself: the model is told where its Agent State lives and is
  invited to edit it with its own file tools.
- **The filesystem lock** is what stops that. On every boot the entrypoint makes
  \`AGENTS.md\`, \`system_config.yaml\`, \`skills/\`, \`hooks/\`, \`tools/\` and \`schedule/\`
  root-owned and unwritable, and the server runs as \`node\`. \`memory/\` and \`.vault.toml\`
  stay writable — the agent's memory is runtime data, and secrets are deployment
  configuration.

The lock lives in this container. Setting \`PENGUIN_PINNED_AGENT\` on an ordinary install gets
you the route guards and nothing else.

A data root that already holds other Projects or agents keeps them when it is started pinned —
they are simply never listed and never served. There is no migration either way.
`
    : ""
}
## What you have to fill in

${
  vaultKeys.length > 0
    ? `The agent expects these vault keys: ${vaultKeys.map((k) => `\`${k}\``).join(", ")}. Values never travel in a bundle — put them in \`.env\`, then set them on the agent with \`penguin config vault set --agent-id ${definition.id} --key <NAME> --value <value>\` inside the container (\`docker compose exec\`), or on its Vault tab.`
    : "The agent declares no vault keys, so the model credentials in `.env` are the whole of it."
}

## Caveats worth reading before you deploy this

- The image installs \`@prismshadow/penguin-cli@latest\` unless you pass
  \`--build-arg PENGUIN_VERSION=<version>\`. Pin it for anything you intend to keep.
- The agent's tools run **inside the container with its permissions**, which is the point of
  containerising it, but the container still reaches the network by default.
- Nothing here terminates TLS or authenticates anyone but the built-in admin. Put it behind
  something that does before exposing it beyond localhost.
`;
}

/**
 * The Docker export's files. The portable definition, skills and hooks travel with them
 * (assembled by the caller), so the same zip both runs the agent and re-imports it.
 *
 * `pin` produces the locked variant: same image and the same compose file, a first boot that
 * imports and then locks, and a server that serves this agent alone.
 */
export function renderDockerDocs(
  definition: PortableAgentDefinition,
  pin: boolean,
): Record<string, string> {
  return {
    Dockerfile: renderDockerfile(pin),
    "docker-compose.yml": renderCompose(definition),
    ".env.example": renderEnvExample(definition, pin),
    "entrypoint.sh": renderEntrypoint(definition, pin),
    "README.md": renderDockerReadme(definition, pin),
    "api/ENDPOINTS.md": renderEndpoints(definition),
  };
}

/** Names of the environment variables the Docker export's container reads (documented in .env.example). */
export function dockerEnvironmentNames(definition: PortableAgentDefinition, pin = false): string[] {
  return dockerEnvNames(definition, pin);
}
