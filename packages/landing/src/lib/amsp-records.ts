/**
 * The record reference's catalogue: for the envelope and every kind of record, an example record
 * with every field filled in, and the payload's fields with their types and whether they are
 * required. Field meanings are in the dictionaries under `amsp.records`, keyed by the same ids and
 * paths, so a field listed here without its words fails to typecheck. The examples are typed on
 * amsp-protocol.ts, which mirrors the protocol's record types; where a field cannot sit in the same
 * record as the others (a user text's `sender` beside a reply's `fidelity`), the example shows one
 * and the field's row carries its own example value.
 */
import type {
  AmspRecord,
  EventPayload,
  ModelPayload,
  SessionMetaPayload,
  TokenCounts,
} from "./amsp-protocol";
import type { RecordKind } from "./amsp-vocabulary";
import type { Strings } from "./strings";

type Words = Strings["amsp"]["records"];
/** What the reference documents: the shared envelope, then each kind of record. */
export type DocId = "envelope" | RecordKind;
type Common = keyof Words["common"];
type FieldPath<Id extends DocId> = (keyof Words["items"][Id]["fields"] & string) | Common;

export interface FieldDoc<Id extends DocId = DocId> {
  /** The field's path in the payload (in the envelope, for the envelope's own fields). */
  path: FieldPath<Id>;
  type: string;
  required: boolean;
  /** An example value where the example record cannot carry this field, as JSON. */
  example?: string;
}

export interface RecordDoc<Id extends DocId = DocId> {
  id: Id;
  example: AmspRecord | Record<string, unknown>;
  fields: readonly FieldDoc<Id>[];
}

const SESSION = "session-2026-10-21-09-41-07-5d0c2e7a";
const CHILD = "session-2026-10-21-09-42-15-a91f03bc";
const CALL_ID = "call_7f3a2c";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";

const stamp = (seconds: number) => `2026-10-21T09:41:${String(seconds).padStart(2, "0")}.000Z`;
const asModel = (seconds: number, payload: ModelPayload): AmspRecord => ({
  timestamp: stamp(seconds),
  type: "model_msg",
  payload,
});
const asEvent = (seconds: number, payload: EventPayload): AmspRecord => ({
  timestamp: stamp(seconds),
  type: "event_msg",
  payload,
});

const counts = (cache_read: number, cache_write: number, output: number, total: number) =>
  ({ cache_read, cache_write, output, total }) satisfies TokenCounts;

const META: SessionMetaPayload = {
  session_id: SESSION,
  provider: "mock",
  model_id: "scripted-model",
  model_context_window: 200000,
  system_prompt:
    "You are coder. Work in the Workspace, run commands with exec_command, and answer briefly.",
  agent_state: "/home/me/.penguin/data/projects/demo/agents/coder",
  workspace: "/home/me/work",
  source: "api",
};

const ROLE = '"user" | "assistant"';
const PHASE = '"start" | "delta" | "stop"';
const STOP = '"completed" | "aborted" | "retryable" | "fatal"';
const COUNTS = ["cache_read", "cache_write", "output", "total"] as const;

/** A record documented by its kind: its example and its payload's fields. */
const doc = <Id extends DocId>(
  id: Id,
  example: AmspRecord | Record<string, unknown>,
  fields: readonly FieldDoc<Id>[],
): RecordDoc<Id> => ({ id, example, fields });

const type = (literal: string) => ({ path: "type", type: `"${literal}"`, required: true }) as const;

export const RECORD_DOCS: { [Id in DocId]: RecordDoc<Id> } = {
  envelope: doc(
    "envelope",
    {
      timestamp: stamp(14),
      type: "event_msg",
      payload: { type: "request_begin", thinking_level: "medium" },
      origin: [CHILD],
    },
    [
      { path: "timestamp", type: "string", required: true },
      { path: "type", type: '"session_meta" | "model_msg" | "event_msg"', required: true },
      { path: "payload", type: "object", required: true },
      { path: "origin", type: "string[]", required: false },
    ],
  ),

  session_meta: doc("session_meta", { timestamp: stamp(7), type: "session_meta", payload: META }, [
    { path: "session_id", type: "string", required: true },
    { path: "provider", type: "string", required: true },
    { path: "model_id", type: "string", required: true },
    { path: "model_context_window", type: 'number | "unknown"', required: true },
    { path: "system_prompt", type: "string", required: true },
    { path: "agent_state", type: "string", required: true },
    { path: "workspace", type: "string", required: true },
    {
      path: "source",
      type: '"user" | "api" | "schedule" | "subagent" | "cli" | "company" | "workbench"',
      required: true,
    },
  ]),

  text: doc(
    "text",
    asModel(13, {
      type: "text",
      role: "assistant",
      text: "It's 09:41 UTC on Wednesday, October 21, 2026, by the server's clock.",
      fidelity: { phase: "final_answer" },
    }),
    [
      type("text"),
      { path: "role", type: ROLE, required: true },
      { path: "text", type: "string", required: true },
      {
        path: "sender",
        type: '"user" | "parent_agent" | "harness" | "server"',
        required: false,
        example: '"harness"',
      },
      { path: "fidelity", type: "object", required: false },
    ],
  ),
  thinking: doc(
    "thinking",
    asModel(11, {
      type: "thinking",
      role: "assistant",
      thinking: "The user wants the current time. I'll read the server's clock with date.",
      fidelity: { signature: "EuYBCkYIBhgCKkB3c2Fh…" },
    }),
    [
      type("thinking"),
      { path: "role", type: '"assistant"', required: true },
      { path: "thinking", type: "string", required: true },
      { path: "fidelity", type: "object", required: false },
    ],
  ),
  tool_call: doc(
    "tool_call",
    asModel(11, {
      type: "tool_call",
      role: "assistant",
      name: "exec_command",
      arguments: '{"cmd":"date"}',
      tool_call_id: CALL_ID,
      fidelity: { id: "fc_08a1c4" },
    }),
    [
      type("tool_call"),
      { path: "role", type: '"assistant"', required: true },
      { path: "name", type: "string", required: true },
      { path: "arguments", type: "string (JSON)", required: true },
      { path: "tool_call_id", type: "string", required: true },
      { path: "fidelity", type: "object", required: false },
    ],
  ),
  tool_call_output: doc(
    "tool_call_output",
    asModel(11, {
      type: "tool_call_output",
      role: "user",
      output: "Wed Oct 21 09:41:11 UTC 2026\n",
      tool_call_id: CALL_ID,
      status: "completed",
    }),
    [
      type("tool_call_output"),
      { path: "role", type: '"user"', required: true },
      { path: "output", type: "string", required: true },
      {
        path: "images",
        type: "string[]",
        required: false,
        example: `["data:image/png;base64,${PNG.slice(0, 12)}…"]`,
      },
      { path: "tool_call_id", type: "string", required: true },
      { path: "status", type: '"completed" | "aborted" | "fatal"', required: true },
    ],
  ),
  image_url: doc(
    "image_url",
    asModel(8, { type: "image_url", role: "user", image_url: "https://example.com/clock.png" }),
    [
      type("image_url"),
      { path: "role", type: '"user"', required: true },
      { path: "image_url", type: "string", required: true },
    ],
  ),
  inline_data: doc(
    "inline_data",
    asModel(8, {
      type: "inline_data",
      role: "user",
      data: PNG,
      mime_type: "image/png",
      fidelity: { id: "file_51c0" },
    }),
    [
      type("inline_data"),
      { path: "role", type: ROLE, required: true },
      { path: "data", type: "string (base64)", required: true },
      { path: "mime_type", type: "string", required: true },
      { path: "fidelity", type: "object", required: false },
    ],
  ),
  inline_thinking: doc(
    "inline_thinking",
    asModel(9, {
      type: "inline_thinking",
      role: "assistant",
      data: PNG,
      mime_type: "image/png",
      fidelity: { signature: "Cp0CAb4+9vu…" },
    }),
    [
      type("inline_thinking"),
      { path: "role", type: '"assistant"', required: true },
      { path: "data", type: "string (base64)", required: true },
      { path: "mime_type", type: "string", required: true },
      { path: "fidelity", type: "object", required: false },
    ],
  ),

  partial_text: doc(
    "partial_text",
    asModel(13, {
      type: "partial_text",
      role: "assistant",
      event_type: "delta",
      text: "It's 09:41 UTC",
    }),
    [
      type("partial_text"),
      { path: "role", type: '"assistant"', required: true },
      { path: "event_type", type: PHASE, required: true },
      { path: "text", type: "string", required: true },
    ],
  ),
  partial_thinking: doc(
    "partial_thinking",
    asModel(9, {
      type: "partial_thinking",
      role: "assistant",
      event_type: "delta",
      thinking: "The user wants the current time.",
    }),
    [
      type("partial_thinking"),
      { path: "role", type: '"assistant"', required: true },
      { path: "event_type", type: PHASE, required: true },
      { path: "thinking", type: "string", required: true },
    ],
  ),
  partial_tool_call: doc(
    "partial_tool_call",
    asModel(11, {
      type: "partial_tool_call",
      role: "assistant",
      event_type: "delta",
      name: "",
      arguments: '{"cmd":"date"}',
      tool_call_id: CALL_ID,
    }),
    [
      type("partial_tool_call"),
      { path: "role", type: '"assistant"', required: true },
      { path: "event_type", type: PHASE, required: true },
      { path: "name", type: "string", required: true, example: '"exec_command"' },
      { path: "arguments", type: "string", required: true },
      { path: "tool_call_id", type: "string", required: true },
    ],
  ),
  partial_tool_call_output: doc(
    "partial_tool_call_output",
    asModel(11, {
      type: "partial_tool_call_output",
      role: "user",
      event_type: "delta",
      output: "Wed Oct 21 09:41:11 UTC 2026\n",
      tool_call_id: CALL_ID,
    }),
    [
      type("partial_tool_call_output"),
      { path: "role", type: '"user"', required: true },
      { path: "event_type", type: PHASE, required: true },
      { path: "output", type: "string", required: true },
      {
        path: "images",
        type: "string[]",
        required: false,
        example: `["data:image/png;base64,${PNG.slice(0, 12)}…"]`,
      },
      { path: "tool_call_id", type: "string", required: true },
    ],
  ),

  task_begin: doc("task_begin", asEvent(7, { type: "task_begin" }), [type("task_begin")]),
  task_end: doc("task_end", asEvent(14, { type: "task_end" }), [type("task_end")]),
  request_begin: doc(
    "request_begin",
    asEvent(7, { type: "request_begin", thinking_level: "medium" }),
    [
      type("request_begin"),
      {
        path: "thinking_level",
        type: '"none" | "low" | "medium" | "high" | "xhigh" | "max"',
        required: false,
      },
    ],
  ),
  request_end: doc(
    "request_end",
    asEvent(9, {
      type: "request_end",
      status: "retryable",
      error_code: "rate_limited",
      error_message: "429 Too Many Requests: rate limit reached for requests",
      attempt: 1,
      retry_in_ms: 2000,
    }),
    [
      type("request_end"),
      { path: "status", type: STOP, required: true },
      { path: "error_code", type: "string", required: false },
      { path: "error_message", type: "string", required: false },
      { path: "attempt", type: "number", required: false },
      { path: "retry_in_ms", type: "number", required: false },
    ],
  ),
  token_usage: doc(
    "token_usage",
    asEvent(14, {
      type: "token_usage",
      session: counts(2816, 2978, 177, 6231),
      request: counts(2816, 162, 31, 3139),
    }),
    [
      type("token_usage"),
      { path: "session", type: "TokenCounts", required: true },
      ...COUNTS.map((field) => ({
        path: `session.${field}` as const,
        type: "number",
        required: true,
      })),
      { path: "request", type: "TokenCounts", required: true },
      ...COUNTS.map((field) => ({
        path: `request.${field}` as const,
        type: "number",
        required: true,
      })),
    ],
  ),

  abort: doc(
    "abort",
    asEvent(40, {
      type: "abort",
      error_code: "max_turns",
      error_message: "reached max turns (50)",
    }),
    [
      type("abort"),
      { path: "error_code", type: "string", required: false },
      { path: "error_message", type: "string", required: false },
      {
        path: "reason",
        type: "string | null",
        required: false,
        example: '"Interrupted by the user."',
      },
    ],
  ),
  approval_decision: doc(
    "approval_decision",
    asEvent(11, { type: "approval_decision", decision: "deny", tool_call_id: CALL_ID }),
    [
      type("approval_decision"),
      { path: "decision", type: '"allow" | "deny" | "forbidden"', required: true },
      { path: "tool_call_id", type: "string", required: true },
    ],
  ),
  hook: doc(
    "hook",
    asEvent(15, {
      type: "hook",
      hook: "stop",
      name: "goal",
      decision: "continue",
      reason: "Round 2 of 5: the goal is not met yet.",
      output: { status: "active", round: 2, tokens_used: 41230, budget: 200000 },
    }),
    [
      type("hook"),
      { path: "hook", type: '"stop" | "pre_tool_use" | "user_prompt"', required: true },
      { path: "name", type: "string", required: true },
      {
        path: "decision",
        type: '"continue" | "stop" | "allow" | "deny"',
        required: false,
      },
      { path: "reason", type: "string", required: false },
      { path: "output", type: "object (scalars)", required: false },
    ],
  ),

  compaction_begin: doc(
    "compaction_begin",
    asEvent(20, {
      type: "compaction_begin",
      reason: "context",
      mode: "summarize",
      context: 171204,
      turns: 38,
    }),
    [
      type("compaction_begin"),
      { path: "reason", type: '"context" | "turns" | "manual"', required: true },
      { path: "mode", type: '"summarize" | "discard"', required: true },
      { path: "context", type: "number", required: true },
      { path: "turns", type: "number", required: true },
    ],
  ),
  compaction_end: doc(
    "compaction_end",
    asEvent(31, {
      type: "compaction_end",
      reason: "context",
      mode: "summarize",
      status: "retryable",
      error_code: "network",
      error_message: "fetch failed: socket hang up",
      attempt: 3,
    }),
    [
      type("compaction_end"),
      { path: "reason", type: '"context" | "turns" | "manual"', required: true },
      { path: "mode", type: '"summarize" | "discard"', required: true },
      { path: "status", type: STOP, required: true },
      { path: "error_code", type: "string", required: false },
      { path: "error_message", type: "string", required: false },
      { path: "attempt", type: "number", required: false },
    ],
  ),
  tool_list_ready: doc(
    "tool_list_ready",
    asEvent(7, {
      type: "tool_list_ready",
      tools: [
        {
          name: "exec_command",
          description: "Run a shell command in the Workspace and return its output.",
          parameters: {
            type: "object",
            properties: { cmd: { type: "string" } },
            required: ["cmd"],
          },
        },
      ],
    }),
    [
      type("tool_list_ready"),
      { path: "tools", type: "object[]", required: true },
      { path: "tools[].name", type: "string", required: true },
      { path: "tools[].description", type: "string", required: true },
      { path: "tools[].parameters", type: "object (JSON Schema)", required: false },
    ],
  ),
  mcp_connect_begin: doc(
    "mcp_connect_begin",
    asEvent(7, { type: "mcp_connect_begin", servers: ["github", "linear"] }),
    [type("mcp_connect_begin"), { path: "servers", type: "string[]", required: true }],
  ),
  mcp_connect_end: doc(
    "mcp_connect_end",
    asEvent(12, {
      type: "mcp_connect_end",
      status: "fatal",
      results: [
        { server: "github", transport: "http", status: "completed", duration_ms: 812, tools: 26 },
        {
          server: "linear",
          transport: "stdio",
          status: "fatal",
          duration_ms: 5004,
          error_code: "connect_failed",
          error_message: "spawn linear-mcp ENOENT",
        },
      ],
    }),
    [
      type("mcp_connect_end"),
      { path: "status", type: STOP, required: true },
      { path: "error_code", type: "string", required: false, example: '"connect_failed"' },
      {
        path: "error_message",
        type: "string",
        required: false,
        example: '"1 of 2 servers failed"',
      },
      { path: "results", type: "object[]", required: true },
      { path: "results[].server", type: "string", required: true },
      { path: "results[].transport", type: '"stdio" | "http" | "sse"', required: true },
      { path: "results[].status", type: STOP, required: true },
      { path: "results[].duration_ms", type: "number", required: true },
      { path: "results[].tools", type: "number", required: false },
      { path: "results[].error_code", type: "string", required: false },
      { path: "results[].error_message", type: "string", required: false },
    ],
  ),
  subagent: doc("subagent", asEvent(15, { type: "subagent", session_id: CHILD }), [
    type("subagent"),
    { path: "session_id", type: "string", required: true },
  ]),
};

/**
 * A field's value in an example, by its path: `a.b` walks objects, `a[].b` takes the first item
 * that has `b`. Undefined when the example does not carry the field.
 */
export function valueAt(source: unknown, path: string): unknown {
  let current: unknown[] = [source];
  for (const part of path.split(".")) {
    const many = part.endsWith("[]");
    const key = many ? part.slice(0, -2) : part;
    const next: unknown[] = [];
    for (const value of current) {
      if (value === null || typeof value !== "object") continue;
      const field = (value as Record<string, unknown>)[key];
      if (field === undefined) continue;
      if (many && Array.isArray(field)) next.push(...field);
      else next.push(field);
    }
    current = next;
  }
  return current[0];
}

/** The example value of one field, as JSON on one line. */
export function exampleOf(record: RecordDoc, field: FieldDoc): string | null {
  if (field.example !== undefined) return field.example;
  const payload =
    record.id === "envelope" ? record.example : (record.example as { payload: unknown }).payload;
  const value = valueAt(payload, field.path);
  return value === undefined ? null : JSON.stringify(value);
}
