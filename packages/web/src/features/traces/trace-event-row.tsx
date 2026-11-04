/**
 * Trace event row (shared): timestamp + type icon + one pill naming the record (its kind, and the
 * role where a kind's role varies: `text (user)`, `text (assistant)`), toned by the record's
 * family (a `model_msg` neutral, an `event_msg` attention) + one-line summary; expanding
 * **renders** the content (text/thinking and session_meta's system prompt go through Markdown,
 * tool arguments/output go through a code block, token_usage goes through a bucket table,
 * session_meta goes through a field table — the Session's every field — and its system prompt)
 * instead of dumping raw JSON; a `status` other than `completed` (a request's end, a tool
 * result, a compaction or MCP connect end) is shown in the bottom-right of the expanded area — a
 * record that completed carries no mark.
 * Linked highlighting with the timeline — a matched row only gets a
 * background color, never an outline; only one row lights up at a time (each
 * row has its own unique rowKey, so adjacent messages at the same timestamp
 * aren't highlighted together).
 */
import { Fragment, useState } from "react";
import {
  Badge,
  Fold,
  GlyphIcon,
  ICONS,
  Pill,
  REHYPE_PLUGINS,
  REMARK_PLUGINS,
  RequiredMark,
  ZoomableImage,
} from "@prismshadow/penguin-ui";
import type { ToneName } from "@prismshadow/penguin-ui";
import ReactMarkdown from "react-markdown";
import { S } from "../../lib/strings";
import type { AmspRecord } from "@prismshadow/amsp";
import { formatTime, humanizeTokens } from "../../lib/format";
import { statusTone } from "../../lib/status-tone";

/**
 * A record family's pill tone, so the two families read apart at a glance down a round's rows:
 * the model's conversation (`model_msg`) neutral, the harness's events (`event_msg`) attention.
 */
function familyTone(type: AmspRecord["type"]): ToneName {
  return type === "event_msg" ? "attention" : "neutral";
}

/** The kinds whose role varies, so their pill names it: a text or an image is the user's or the model's. */
const ROLE_KINDS: ReadonlySet<string> = new Set(["text", "inline_data"]);

/**
 * What a row's pill says: the record's kind, plus its role for the kinds whose role varies —
 * `text (user)`, `text (assistant)`, `inline_data (user)`; every other kind is bare.
 */
function kindLabel(msg: AmspRecord): string {
  const p = msg.payload as { type?: string; role?: unknown };
  const kind = p.type ?? msg.type;
  return ROLE_KINDS.has(kind) && typeof p.role === "string" ? `${kind} (${p.role})` : kind;
}

/**
 * The glyph of each event type; a type not listed wears the circled exclamation. Where the chat
 * already has a mark for the same thing, the event wears it: the stopped square for an abort,
 * the squeeze for compaction, the agent pair for a subagent.
 */
const TYPE_ICON: Record<string, string> = {
  text: ICONS.bubbleLines,
  thinking: ICONS.lightbulb,
  image_url: ICONS.image,
  inline_data: ICONS.image,
  tool_call: ICONS.wrench,
  tool_call_output: ICONS.terminalPrompt,
  token_usage: ICONS.barChart,
  request_begin: ICONS.arrowRightCentered,
  request_end: ICONS.arrowLeftCentered,
  // A Task's pair: it starts, and it reached its end (however it ended — the records inside say).
  task_begin: ICONS.play,
  task_end: ICONS.target,
  approval_decision: ICONS.shieldCheck,
  compaction_begin: ICONS.compress,
  compaction_end: ICONS.compress,
  abort: ICONS.stopCircle,
  subagent: ICONS.robotPair,
  // A hook's answer: the hook glyph the settings tab and the harness card use.
  hook: ICONS.fishHook,
  // MCP connect pair: a plug; tool_list_ready reuses the wrench (a toolset record).
  mcp_connect_begin: ICONS.plug,
  mcp_connect_end: ICONS.plug,
  tool_list_ready: ICONS.wrench,
};

function TypeIcon({ type }: { type: string }) {
  return (
    <GlyphIcon
      d={TYPE_ICON[type] ?? ICONS.alertCircle}
      size={13}
      className="text-gray-400 dark:text-gray-500"
    />
  );
}

/** One-line summary: pull key info per payload type (truncated to one line). */
export function summarizeEvent(msg: AmspRecord): string {
  const p = msg.payload as Record<string, unknown> & { type?: string };
  switch (p.type) {
    case undefined:
      return "";
    case "text":
      // The role is on the row's pill.
      return String(p["text"] ?? "").slice(0, 120);
    case "thinking":
      return String(p["thinking"] ?? "").slice(0, 120);
    case "image_url":
      return "[image]";
    case "inline_data":
      return `[image] ${String(p["mime_type"] ?? "")}`;
    case "tool_call":
      return `${String(p["name"])} ${String(p["arguments"] ?? "").slice(0, 100)}`;
    case "tool_call_output": {
      const text = String(p["output"] ?? "").slice(0, 120);
      // Tool output carrying an image: prefix the summary with [image] to flag it.
      return Array.isArray(p["images"]) && p["images"].length > 0 ? `[image] ${text}` : text;
    }
    case "token_usage": {
      const req = p["request"] as { total?: number } | undefined;
      const ses = p["session"] as { total?: number } | undefined;
      return `request.total=${req?.total ?? 0} session.total=${ses?.total ?? 0}`;
    }
    case "request_begin":
      // The level the request went out at; a Trace written before the field records none.
      return typeof p["thinking_level"] === "string" ? `thinking_level=${p["thinking_level"]}` : "";
    case "request_end":
      return `status=${String(p["status"])}`;
    case "approval_decision":
      return `${String(p["decision"])} · ${String(p["tool_call_id"])}`;
    case "compaction_begin":
    case "compaction_end":
      return `${String(p["mode"])} (${String(p["reason"])})${p["status"] ? ` · ${String(p["status"])}` : ""}`;
    case "mcp_connect_begin":
      return Array.isArray(p["servers"]) ? p["servers"].map(String).join(", ") : "";
    case "mcp_connect_end": {
      // The phase's total wall time is the pair's timestamp difference (shown by the
      // timeline span); the row summarizes the overall status and per-server outcomes.
      const results = Array.isArray(p["results"])
        ? (p["results"] as { server?: string; status?: string; duration_ms?: number }[])
        : [];
      const parts = results.map(
        (r) => `${String(r.server)}:${String(r.status)}(${String(r.duration_ms)}ms)`,
      );
      return [String(p["status"] ?? ""), parts.join(" ")].filter(Boolean).join(" · ");
    }
    case "tool_list_ready":
      return Array.isArray(p["tools"]) ? S.traces.toolDefs(p["tools"].length) : "";
    case "abort": {
      // Live events carry the unified pair; legacy Traces spell the cause as `reason` prose.
      const code = p["error_code"] != null ? String(p["error_code"]) : "";
      const detail = p["error_message"] != null ? String(p["error_message"]) : "";
      const legacy = p["reason"] != null ? String(p["reason"]) : "";
      return [code || legacy, detail].filter(Boolean).join(" · ");
    }
    case "hook": {
      // A hook's answer: its name, decision and reason, then its structured record as k=v.
      const output = p["output"];
      const record =
        output && typeof output === "object"
          ? Object.entries(output as Record<string, unknown>)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(" ")
          : "";
      return [
        p["name"] != null ? String(p["name"]) : "",
        p["decision"] != null ? String(p["decision"]) : "",
        p["reason"] != null ? String(p["reason"]) : "",
        record,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "subagent":
      return String(p["session_id"] ?? "");
    default:
      if (msg.type === "session_meta") {
        return `${String(p["session_id"] ?? "")} · ${String(p["model_id"] ?? "")}`;
      }
      return "";
  }
}

/** The record's `status` (request_end, tool_call_output, compaction_end, mcp_connect_end); undefined if absent. */
function statusOf(msg: AmspRecord): string | undefined {
  return (msg.payload as { status?: string }).status;
}

const codeBlock =
  "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-100 px-2.5 py-2 text-xs dark:bg-gray-800/70";

/** token_usage bucket table (a single event only reports exact numbers; the donut ring only appears in the top-right of the Task card, so it isn't redrawn here). */
function UsageTable({ p }: { p: Record<string, unknown> }) {
  const req = (p.request ?? {}) as Record<string, number>;
  const ses = (p.session ?? {}) as Record<string, number>;
  const row = (label: string, r: Record<string, number>) => (
    <tr>
      <td className="pr-3 text-gray-400">{label}</td>
      <td className="pr-3 text-right font-mono">{humanizeTokens(r.cache_read ?? 0)}</td>
      <td className="pr-3 text-right font-mono">{humanizeTokens(r.cache_write ?? 0)}</td>
      <td className="pr-3 text-right font-mono">{humanizeTokens(r.output ?? 0)}</td>
      <td className="text-right font-mono">{humanizeTokens(r.total ?? 0)}</td>
    </tr>
  );
  return (
    <table className="text-xs">
      <thead>
        <tr className="text-gray-400">
          <th />
          <th className="pr-3 text-right font-normal">cacheRead</th>
          <th className="pr-3 text-right font-normal">cacheWrite</th>
          <th className="pr-3 text-right font-normal">output</th>
          <th className="text-right font-normal">total</th>
        </tr>
      </thead>
      <tbody>
        {row("request", req)}
        {row("session", ses)}
      </tbody>
    </table>
  );
}

const summaryClass =
  "text-xs font-medium text-gray-500 marker:text-gray-400 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200";

/** session_meta: a field table + system prompt (Markdown) + tool definition list. */
function SessionMetaBody({ p }: { p: Record<string, unknown> }) {
  const rows: Array<[string, string]> = [
    ["session_id", String(p.session_id ?? "")],
    // The Session's source as the record carries it; a Trace from before the source was
    // required has none and shows the empty dash.
    ["source", String(p.source ?? "")],
    ["provider", String(p.provider ?? "")],
    ["model_id", String(p.model_id ?? "")],
    ["context_window", String(p.model_context_window ?? "")],
    // Legacy metas only: current traces no longer record a thinking level (it is a
    // per-request Session parameter), but old traces still carry the field — keep showing
    // it for them (loose read) instead of losing the display.
    ...(typeof p.thinking_level === "string" && p.thinking_level
      ? ([["thinking_level", p.thinking_level]] as Array<[string, string]>)
      : []),
    ["agent_state", String(p.agent_state ?? "")],
    ["workspace", String(p.workspace ?? "")],
  ];
  const prompt = String(p.system_prompt ?? "");
  // Pre-split traces embedded `tools` here; per the explicit-incompatibility decision the
  // legacy field is not rendered — the toolset view is the tool_list_ready event.
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-gray-400">{k}</dt>
            <dd className="min-w-0 break-all font-mono text-gray-700 dark:text-gray-300">
              {v || "—"}
            </dd>
          </Fragment>
        ))}
      </dl>

      {prompt.trim() && (
        <details>
          <summary className={summaryClass}>{S.traces.systemPrompt}</summary>
          <div className="md-body mt-1.5 max-h-96 overflow-auto rounded bg-gray-100 px-2.5 py-2 text-sm leading-relaxed text-gray-700 dark:bg-gray-800/70 dark:text-gray-300">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
              {prompt}
            </ReactMarkdown>
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * A JSON-Schema object rendered as a property table (name / type / required / description)
 * — the form a tool schema is actually read in; non-object schemas fall back to JSON.
 */
function ParamsTable({ schema }: { schema: Record<string, unknown> }) {
  const props =
    schema["properties"] !== null && typeof schema["properties"] === "object"
      ? (schema["properties"] as Record<string, Record<string, unknown>>)
      : null;
  if (!props || Object.keys(props).length === 0) {
    return <pre className={`${codeBlock} mt-1`}>{JSON.stringify(schema, null, 2)}</pre>;
  }
  const required = new Set(
    Array.isArray(schema["required"]) ? (schema["required"] as unknown[]).map(String) : [],
  );
  /** Compact type label: plain `type`, enum value lists, and array item types; anything else reads "object". */
  const typeOf = (s: Record<string, unknown>): string => {
    if (Array.isArray(s["enum"])) return (s["enum"] as unknown[]).map(String).join(" | ");
    const t = typeof s["type"] === "string" ? s["type"] : "object";
    if (t === "array") {
      const items = s["items"];
      const inner =
        items !== null && typeof items === "object"
          ? typeOf(items as Record<string, unknown>)
          : "unknown";
      return `${inner}[]`;
    }
    return t;
  };
  return (
    <table className="mt-1 w-full text-xs">
      <tbody>
        {Object.entries(props).map(([name, s]) => (
          <tr key={name} className="align-top">
            <td className="whitespace-nowrap pr-3 font-mono text-gray-700 dark:text-gray-300">
              {name}
              {required.has(name) && <RequiredMark label={S.traces.requiredParam} />}
            </td>
            <td className="whitespace-nowrap pr-3 font-mono text-gray-400 dark:text-gray-500">
              {typeOf(s)}
            </td>
            <td className="text-gray-500 dark:text-gray-400">
              {typeof s["description"] === "string" ? s["description"] : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * tool_list_ready: the Session's resolved toolset as a structured list — name +
 * description per tool, with the parameter schema as a property table behind a per-tool
 * disclosure (raw JSON dumps read terribly for tool schemas of this size).
 */
function ToolListReadyBody({ p }: { p: Record<string, unknown> }) {
  const tools = Array.isArray(p.tools)
    ? (p.tools as Array<{ name?: string; description?: string; parameters?: unknown }>)
    : [];
  if (tools.length === 0) return <p className="text-xs text-gray-400">—</p>;
  return (
    <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800/60 dark:border-gray-800">
      {tools.map((t, i) => (
        <li key={i} className="px-2.5 py-1.5 text-xs">
          <span className="font-mono font-semibold text-gray-700 dark:text-gray-300">
            {t.name ?? "—"}
          </span>
          {t.description && (
            <p className="mt-0.5 text-gray-500 dark:text-gray-400">{t.description}</p>
          )}
          {t.parameters !== null && typeof t.parameters === "object" && (
            <details className="mt-1">
              <summary className={summaryClass}>{S.traces.toolParams}</summary>
              <ParamsTable schema={t.parameters as Record<string, unknown>} />
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Expanded-area content: rendered per type (no raw JSON dump). */
function EventBody({ msg }: { msg: AmspRecord }) {
  const p = msg.payload as Record<string, unknown> & { type?: string };
  if (msg.type === "session_meta") return <SessionMetaBody p={p} />;
  if (p.type === "tool_list_ready") return <ToolListReadyBody p={p} />;
  switch (p.type) {
    case "text":
    case "thinking": {
      const md = String(p.text ?? p.thinking ?? "");
      if (!md.trim()) return <p className="text-xs text-gray-400">—</p>;
      return (
        <div className="md-body text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
            {md}
          </ReactMarkdown>
        </div>
      );
    }
    case "image_url":
      return (
        <ZoomableImage
          src={String(p.image_url ?? "")}
          alt="trace"
          className="max-h-48 max-w-full rounded-md"
        />
      );
    case "inline_data":
      // base64 bytes + mime → render directly as a data URL.
      return (
        <ZoomableImage
          src={`data:${String(p.mime_type ?? "")};base64,${String(p.data ?? "")}`}
          alt="trace"
          className="max-h-48 max-w-full rounded-md"
        />
      );
    case "tool_call":
      return (
        <div className="space-y-1.5">
          <p className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">
            {String(p.name ?? "")}
          </p>
          <pre className={codeBlock}>{String(p.arguments ?? "")}</pre>
        </div>
      );
    case "tool_call_output": {
      // Tool output carrying images (e.g. read_file on an image): render images below the text code block.
      const images = Array.isArray(p.images) ? (p.images as string[]) : [];
      if (images.length === 0) return <pre className={codeBlock}>{String(p.output ?? "")}</pre>;
      return (
        <div className="space-y-1.5">
          <pre className={codeBlock}>{String(p.output ?? "")}</pre>
          <div className="flex flex-wrap gap-2">
            {images.map((src, i) => (
              <ZoomableImage
                key={i}
                src={src}
                alt="trace"
                className="max-h-48 max-w-full rounded-md"
              />
            ))}
          </div>
        </div>
      );
    }
    case "token_usage":
      return <UsageTable p={p} />;
    default:
      // Short events like compaction / abort / request_*: key-value pairs are enough (session_meta is already rendered separately above).
      return <pre className={codeBlock}>{JSON.stringify(p, null, 2)}</pre>;
  }
}

export function EventRow({
  msg,
  rowKey,
  matched,
  onHighlight,
  summary,
}: {
  msg: AmspRecord;
  /** This row's unique identifier (the scroll target for timeline jumps, and also the basis for "only one row lights up"). */
  rowKey: string;
  matched: boolean;
  onHighlight?: (h: { ts: string; rowKey: string } | null) => void;
  /** A summary the row's context computed in place of the record's own (a thinking-level change). */
  summary?: string;
}) {
  const [open, setOpen] = useState(false);
  const payloadType = (msg.payload as { type?: string }).type ?? msg.type;
  const status = statusOf(msg);
  return (
    <li data-trace-row={rowKey}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => onHighlight?.({ ts: msg.timestamp, rowKey })}
        onMouseLeave={() => onHighlight?.(null)}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 ${
          matched
            ? "bg-amber-50 dark:bg-amber-950/40"
            : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
        }`}
      >
        <span className="shrink-0 font-mono text-xs text-gray-400">
          {formatTime(msg.timestamp)}
        </span>
        <TypeIcon type={payloadType} />
        {/* The file's head is not a stream record: it stands out as a solid tag. */}
        <span className="shrink-0">
          {msg.type === "session_meta" ? (
            <Badge tone="neutral" variant="solid" size="sm">
              {payloadType}
            </Badge>
          ) : (
            <Pill tone={familyTone(msg.type)}>{kindLabel(msg)}</Pill>
          )}
        </span>
        {msg.origin && msg.origin.length > 0 && (
          <Badge variant="solid" size="sm">
            origin
          </Badge>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
          {summary ?? summarizeEvent(msg)}
        </span>
      </button>
      {/* The body folds under the theme's layout motion, and is built only while it shows: a
          rendered event (Markdown, a code block, a table) costs something, and a Trace has
          hundreds of rows the reader never opens. */}
      <Fold open={open}>
        {() => (
          <div className="border-t border-gray-100 bg-gray-50/60 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/40">
            <EventBody msg={msg} />
            {/* Status, bottom-right, only when the record did not complete: completed is the
                absence of a mark. */}
            {status !== undefined && status !== "completed" && (
              <div className="mt-1.5 flex justify-end">
                <Badge tone={statusTone(status)}>{status}</Badge>
              </div>
            )}
          </div>
        )}
      </Fold>
    </li>
  );
}
