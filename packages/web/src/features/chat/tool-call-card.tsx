/**
 * Tool call card: collapses to a single line by
 * default — status icon + tool name + duration (a live-ticking timer while running) + status
 * badge; clicking expands full arguments, output, and any nested subagent.
 * The pending-approval row is always visible regardless of collapsed state; when a pending
 * approval appears anywhere in a nested subagent chain, the card auto-expands once (respecting
 * the user's choice if they've manually collapsed it since).
 *
 * Duration accounting = **argument-generation segment + execution segment** (excludes time
 * spent waiting on human approval): the model streaming out arguments token by token is often
 * slower than the tool call itself, so reporting only the execution segment would badly
 * understate this step's cost. While waiting on approval, the already-settled generation
 * segment is shown, with a separate "Waiting for approval" badge attached.
 */
import { useEffect, useRef, useState } from "react";
import { S } from "../../lib/strings";
import { humanizeDuration } from "../../lib/format";
import { approvalKey } from "../../lib/omni/stream-model";
import type { ToolCallItem } from "../../lib/omni/stream-model";
import { Badge, stopReasonTone } from "../../components/ui/badge";
import { Chevron } from "../../components/ui/chevron";
import { ZoomableImage } from "../../components/ui/image-zoom";
import { StatusIcon } from "../../components/ui/status-icon";
import type { RunState } from "../../components/ui/status-icon";
import { ApprovalButtons } from "./approval-buttons";
import { LiveDuration } from "./live-duration";
import { SubagentCard } from "./subagent-card";
import type { StreamRenderContext } from "./message-stream";

/**
 * Argument preview (same approach as the CLI's tool-render): exec_command shows `$ <cmd>`,
 * other tools show a single-line `name(args)` prefix. Arguments may be incomplete JSON
 * (mid-stream), so extraction is done leniently.
 */
function previewArguments(name: string, argsJson: string): string {
  if (name === "exec_command") {
    const cmd = extractStringField(argsJson, "cmd");
    if (cmd !== null) return `$ ${cmd.replace(/\s+/g, " ").trim()}`;
  }
  return argsJson.replace(/\s+/g, " ").trim();
}

/** Extracts the current value of a string field from a possibly-incomplete JSON object string (a simplified version, good enough for preview purposes). */
function extractStringField(argsJson: string, field: string): string | null {
  const key = `"${field}"`;
  const keyIndex = argsJson.indexOf(key);
  if (keyIndex === -1) return null;
  let i = keyIndex + key.length;
  while (/\s/.test(argsJson[i] ?? "")) i += 1;
  if (argsJson[i] !== ":") return null;
  i += 1;
  while (/\s/.test(argsJson[i] ?? "")) i += 1;
  if (argsJson[i] !== '"') return null;
  i += 1;
  let out = "";
  let escaped = false;
  for (; i < argsJson.length; i += 1) {
    const ch = argsJson[i]!;
    if (escaped) {
      out += ch === "n" ? "\n" : ch === "t" ? "\t" : ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
  }
  return out;
}

export function ToolCallCard({ item, ctx }: { item: ToolCallItem; ctx: StreamRenderContext }) {
  const [open, setOpen] = useState(false);
  const userToggled = useRef(false);
  // Matched by the current origin chain + toolCallId: prevents parent/child session tool_call_id collisions from lighting each other up.
  const pending = ctx.pendingApprovals.get(approvalKey(ctx.origin, item.toolCallId));

  // Whether there's a pending approval anywhere in the nested subagent chain (keys are `origin-chain toolCallId`, matched by prefix at any depth).
  const nestedPrefix = item.subagentSessionId
    ? [...ctx.origin, item.subagentSessionId].join("/")
    : null;
  const hasNestedPending =
    nestedPrefix !== null &&
    [...ctx.pendingApprovals.keys()].some(
      (k) => k.startsWith(`${nestedPrefix} `) || k.startsWith(`${nestedPrefix}/`),
    );

  // A nested pending approval needs the user's action: auto-expand once (respected if the user manually collapses it afterward).
  useEffect(() => {
    if (hasNestedPending && !userToggled.current) setOpen(true);
  }, [hasNestedPending]);

  const preview = previewArguments(item.name, item.argumentsText);
  // Executing = the call has finished streaming, output hasn't arrived yet, and it's not waiting on approval (approval wait time doesn't count toward execution).
  const executing = item.callComplete && !item.outputComplete && !pending;
  // Argument-generation segment (settled): the live execution timer accumulates on top of this as a baseline, so the displayed duration doesn't shrink back once output arrives.
  const genMs =
    item.argStartedAtMs !== undefined && item.callStartedAtMs !== undefined
      ? Math.max(0, item.callStartedAtMs - item.argStartedAtMs)
      : 0;
  const failed =
    (item.callStopReason !== undefined && item.callStopReason !== "completed") ||
    (item.outputStopReason !== undefined && item.outputStopReason !== "completed");
  const state: RunState = pending
    ? "waiting"
    : executing || item.callStreaming
      ? "running"
      : failed
        ? "failed"
        : "done";
  const stateLabel = pending
    ? S.chat.approvalWaiting
    : state === "running"
      ? S.chat.workRunning
      : state === "done"
        ? S.chat.workDone
        : (item.outputStopReason ?? item.callStopReason);

  return (
    <div>
      {/* Collapsed row: status icon + tool name + total duration (generation + execution, excluding approval wait). Expand chevron on the right. */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          userToggled.current = true;
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50"
      >
        <StatusIcon state={state} label={stateLabel} />
        <span className="shrink-0 truncate font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">
          {item.name || S.chat.unknownTool}
        </span>
        <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
          {item.durationMs !== undefined ? (
            humanizeDuration(item.durationMs)
          ) : executing ? (
            // Execution timer: argument-generation baseline + a live segment starting from approval grant (or from call completion if no approval was needed).
            <LiveDuration sinceMs={item.approvalAtMs ?? item.callStartedAtMs} offsetMs={genMs} />
          ) : pending ? (
            // No ticking while waiting on approval: frozen at the settled argument-generation segment.
            genMs > 0 ? (
              humanizeDuration(genMs)
            ) : null
          ) : item.callStreaming ? (
            // Generating arguments: live-ticking timer (falls back to a pulsing ellipsis when no start time is known).
            item.argStartedAtMs !== undefined ? (
              <LiveDuration sinceMs={item.argStartedAtMs} />
            ) : (
              <span className="animate-pulse">…</span>
            )
          ) : null}
        </span>
        {pending && (
          <span className="shrink-0 font-mono text-xs text-amber-600 dark:text-amber-400">
            {S.chat.approvalWaiting}
          </span>
        )}
        {item.callStopReason && item.callStopReason !== "completed" && (
          <Badge tone={stopReasonTone(item.callStopReason)}>{item.callStopReason}</Badge>
        )}
        {item.outputStopReason && item.outputStopReason !== "completed" && (
          <Badge tone={stopReasonTone(item.outputStopReason)}>{item.outputStopReason}</Badge>
        )}
        {item.decision && (
          <Badge tone={item.decision === "allow" ? "green" : "red"}>
            {item.decision === "allow" ? S.chat.decisionAllow : S.chat.decisionDeny}
            {" · "}
            {item.decisionSource === "manual" ? S.chat.decisionManual : S.chat.decisionAuto}
          </Badge>
        )}
        <span className="min-w-0 flex-1" />
        {/* Expand indicator on the right */}
        <Chevron open={open} className="text-gray-400" />
      </button>

      {/* Pending approval: always visible regardless of collapsed state — shows the tool name and arguments so the user knows what they're approving. */}
      {pending && (
        <div className="border-t border-gray-100 bg-amber-50 px-3 py-2 dark:border-gray-800 dark:bg-amber-950/30">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 font-mono text-xs font-semibold text-gray-700 dark:bg-gray-900 dark:text-gray-300">
              {item.name || S.chat.unknownTool}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-600 dark:text-gray-400">
              {preview}
            </span>
          </div>
          <ApprovalButtons
            onDecide={(decision) => ctx.onApprove(item.toolCallId, decision, ctx.origin)}
          />
        </div>
      )}

      {/* Expanded details: full arguments / output */}
      {open && (
        <div className="anim-fade">
          {item.argumentsText && (
            // Arguments are shown as a fully wrapped block (no height cap, no scrollbar): the
            // arguments are key to understanding this call, and tucking them into an inner
            // scroll area would make them hard to read and fight with the message stream's own scroll.
            <pre className="whitespace-pre-wrap break-all border-t border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950/60 dark:text-gray-400">
              {item.argumentsText}
            </pre>
          )}
          {(item.output || item.outputStreaming) && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-gray-100 px-3 py-2 text-xs leading-5 text-gray-600 dark:border-gray-800 dark:text-gray-300">
              {item.output}
              {item.outputStreaming && <span className="animate-pulse">▌</span>}
            </pre>
          )}
          {/* Tool output images (e.g. read_image): shown as thumbnails, click to zoom (ZoomableImage). */}
          {item.images && item.images.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-gray-100 px-3 py-2 dark:border-gray-800">
              {item.images.map((src, i) => (
                <ZoomableImage
                  key={i}
                  src={src}
                  alt={S.chat.toolImageAlt}
                  className="max-h-40 max-w-full rounded-md border border-gray-200 dark:border-gray-700"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Subagent card: always visible (not hidden after completion, only collapsed by default), unaffected by the tool card's collapsed state. Rendered below the expanded arguments/output so the nested conversation reads after the tool call's own content, not between the header and its details. */}
      {item.subagent && (
        <div className="px-3 pb-2">
          <SubagentCard
            sessionId={item.subagentSessionId ?? ""}
            model={item.subagent}
            running={!item.outputComplete}
            ctx={ctx}
          />
        </div>
      )}
    </div>
  );
}
