/**
 * Trace event row (shared): timestamp + type icon + type badge + one-line
 * summary; expanding **renders** the content (text/thinking and session_meta's
 * system prompt go through Markdown, tool arguments/output go through a code
 * block, token_usage goes through a bucket table, session_meta goes through a
 * field table + tool definitions) instead of dumping raw JSON;
 * the stop reason (stop_reason / status) is shown in the bottom-right of the
 * expanded area.
 * Linked highlighting with the timeline — a matched row only gets a
 * background color, never an outline; only one row lights up at a time (each
 * row has its own unique rowKey, so adjacent messages at the same timestamp
 * aren't highlighted together).
 */
import { Fragment, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { S } from "../../lib/strings";
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import { formatTime, humanizeTokens } from "../../lib/format";
import { Badge, stopReasonTone } from "../../components/ui/badge";
import type { BadgeTone } from "../../components/ui/badge";
import { ZoomableImage } from "../../components/ui/image-zoom";

export function typeTone(type: string): BadgeTone {
  if (type === "session_meta") return "brand";
  if (type === "model_msg") return "gray";
  return "amber";
}

/** Icon for each event type (24×24 line path). */
const TYPE_ICON: Record<string, string> = {
  text: "M8 10h8M8 14h5M21 12a9 9 0 1 1-4-7.5",
  thinking: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3 11v2h6v-2a6 6 0 0 0-3-11z",
  image_url: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6",
  inline_data: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6",
  tool_call: "M14.7 6.3a4 4 0 0 0-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.5 2.5-2-2 2.5-2.5z",
  tool_call_output: "M4 6l4 4-4 4M12 18h8",
  token_usage: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  request_begin: "M5 12h14M13 6l6 6-6 6",
  request_end: "M19 12H5M11 6l-6 6 6 6",
  approval_decision: "M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z",
  compaction_begin: "M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4M9 12h6",
  compaction_end: "M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4M9 12h6",
  abort: "M6 6h12v12H6z",
  subagent: "M12 3v6m0 0l-5 4v8m5-12l5 4v8M4 21h16",
};
const DEFAULT_ICON = "M12 8v5m0 3h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z";

function TypeIcon({ type }: { type: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-gray-400 dark:text-gray-500"
      aria-hidden
    >
      <path d={TYPE_ICON[type] ?? DEFAULT_ICON} />
    </svg>
  );
}

/** One-line summary: pull key info per payload type (truncated to one line). */
export function summarizeEvent(msg: OmniMessage): string {
  const p = msg.payload as Record<string, unknown> & { type?: string };
  switch (p.type) {
    case undefined:
      return "";
    case "text":
      return `${String(p["role"])}: ${String(p["text"] ?? "").slice(0, 120)}`;
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
    case "request_end":
      return `status=${String(p["status"])}`;
    case "approval_decision":
      return `${String(p["decision"])} · ${String(p["tool_call_id"])}`;
    case "compaction_begin":
    case "compaction_end":
      return `${String(p["mode"])} (${String(p["reason"])})${p["status"] ? ` · ${String(p["status"])}` : ""}`;
    case "abort":
      return p["reason"] != null ? String(p["reason"]) : "";
    case "subagent":
      return String(p["session_id"] ?? "");
    default:
      if (msg.type === "session_meta") {
        return `${String(p["session_id"] ?? "")} · ${String(p["model_id"] ?? "")}`;
      }
      return "";
  }
}

/** Stop reason (a model message's stop_reason / request_end's status); undefined if absent. */
function stopReasonOf(msg: OmniMessage): string | undefined {
  const p = msg.payload as { stop_reason?: string; status?: string };
  return p.stop_reason ?? p.status;
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
  "cursor-pointer text-xs font-medium text-gray-500 marker:text-gray-400 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200";

/** session_meta: a field table + system prompt (Markdown) + tool definition list. */
function SessionMetaBody({ p }: { p: Record<string, unknown> }) {
  const rows: Array<[string, string]> = [
    ["session_id", String(p.session_id ?? "")],
    // Session origin (subagent / schedule); user-created sessions have no source and show the empty dash.
    ["source", String(p.source ?? "")],
    ["model_id", String(p.model_id ?? "")],
    ["context_window", String(p.model_context_window ?? "")],
    // Fork provenance (model switch): the source session id; non-forked sessions show the empty dash.
    ["forked_from", String(p.forked_from ?? "")],
    ["agent_state", String(p.agent_state ?? "")],
    ["workspace", String(p.workspace ?? "")],
  ];
  const prompt = String(p.system_prompt ?? "");
  const tools = Array.isArray(p.tools)
    ? (p.tools as Array<{ name?: string; description?: string }>)
    : [];
  return (
    <div className="space-y-2.5">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{prompt}</ReactMarkdown>
          </div>
        </details>
      )}

      {tools.length > 0 && (
        <details>
          <summary className={summaryClass}>{S.traces.toolDefs(tools.length)}</summary>
          <ul className="mt-1.5 space-y-1">
            {tools.map((t, i) => (
              <li key={i} className="text-xs">
                <span className="font-mono font-semibold text-gray-700 dark:text-gray-300">
                  {t.name ?? "—"}
                </span>
                {t.description && (
                  <span className="ml-2 text-gray-500 dark:text-gray-400">{t.description}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Expanded-area content: rendered per type (no raw JSON dump). */
function EventBody({ msg }: { msg: OmniMessage }) {
  const p = msg.payload as Record<string, unknown> & { type?: string };
  if (msg.type === "session_meta") return <SessionMetaBody p={p} />;
  switch (p.type) {
    case "text":
    case "thinking": {
      const md = String(p.text ?? p.thinking ?? "");
      if (!md.trim()) return <p className="text-xs text-gray-400">—</p>;
      return (
        <div className="md-body text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
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
      // Tool output carrying images (e.g. read_image): render images below the text code block.
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
}: {
  msg: OmniMessage;
  /** This row's unique identifier (the scroll target for timeline jumps, and also the basis for "only one row lights up"). */
  rowKey: string;
  matched: boolean;
  onHighlight?: (h: { ts: string; rowKey: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const payloadType = (msg.payload as { type?: string }).type ?? msg.type;
  const stopReason = stopReasonOf(msg);
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
        <span className="shrink-0 font-mono text-[11px] text-gray-400">
          {formatTime(msg.timestamp)}
        </span>
        <TypeIcon type={payloadType} />
        <Badge tone={typeTone(msg.type)}>{payloadType}</Badge>
        {msg.origin && msg.origin.length > 0 && <Badge tone="brand">origin</Badge>}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
          {summarizeEvent(msg)}
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/40">
          <EventBody msg={msg} />
          {/* Stop reason: bottom-right */}
          {stopReason && (
            <div className="mt-1.5 flex justify-end">
              <Badge tone={stopReasonTone(stopReason)}>{stopReason}</Badge>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
