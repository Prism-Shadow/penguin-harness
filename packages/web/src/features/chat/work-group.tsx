/**
 * "Reasoning & Tools" group: collapses a run of consecutive thinking +
 * tool-call items into one aggregated group.
 * Expand policy: the group defaults to expanded while it's the last segment of the message
 * stream (the current turn still in progress), and defaults to collapsed once later messages
 * push it away from the end (turn finished); a manual toggle by the user is respected afterward.
 * A pending approval **forces it open** — otherwise the approval buttons would be unreachable.
 *
 * Hierarchy: the group header is **a distinct title bar** (solid light-gray background + small
 * uppercase status text), and the thinking/tool-call rows inside the group sit on the white
 * area below it — the two are deliberately different layers, otherwise "Running"/"Done" would
 * blend visually with the step rows and the parent-child relationship would be unreadable.
 *
 * Status semantics: the group only counts as "Done" once the model stops calling tools. As long
 * as this is still the last segment and the Task is running, the model could add another step
 * at any moment (there can be a brief gap with no active item between two steps), so it always
 * shows "Running"; it flips to "Done" only once a later message (e.g. body text) pushes the
 * group away from the end, or the Task has actually finished.
 */
import { useEffect, useRef, useState } from "react";
import { S } from "../../lib/strings";
import { humanizeDuration } from "../../lib/format";
import { Chevron } from "../../components/ui/chevron";
import { StatusIcon } from "../../components/ui/status-icon";
import { approvalKey } from "../../lib/omni/stream-model";
import type { ChatItem } from "../../lib/omni/stream-model";
import { LiveDuration } from "./live-duration";
import { MessageItem } from "./message-item";
import type { StreamRenderContext } from "./message-stream";
import { summarizeWork } from "./work-summary";

/** Item kinds that belong in the group: thinking and tool calls (subagent cards are nested inside the run_subagent tool card, not listed separately). */
export function isWorkItem(item: ChatItem): boolean {
  return item.kind === "thinking" || item.kind === "tool_call";
}

/** Whether an item is still in progress (drives spinner display): streaming, executing, or has a pending approval. */
function itemActive(item: ChatItem, ctx: StreamRenderContext): boolean {
  if (item.kind === "thinking") return item.streaming;
  if (item.kind === "tool_call") {
    if (item.callStreaming || item.outputStreaming) return true;
    if (item.callComplete && !item.outputComplete) return true;
    return ctx.pendingApprovals.has(approvalKey(ctx.origin, item.toolCallId));
  }
  return false;
}

/** Whether the group contains a pending approval (used to force it open, ensuring the approval buttons stay reachable). */
function hasPendingApproval(items: ChatItem[], ctx: StreamRenderContext): boolean {
  return items.some(
    (it) =>
      it.kind === "tool_call" && ctx.pendingApprovals.has(approvalKey(ctx.origin, it.toolCallId)),
  );
}

export function WorkGroup({
  items,
  ctx,
  isLast,
}: {
  items: ChatItem[];
  ctx: StreamRenderContext;
  /** Whether this group is the last segment of the message stream (current turn still in progress): decides the default expanded/collapsed state. */
  isLast: boolean;
}) {
  // Last segment + Task running = the model might still call another tool → show Running (even if there's no active item right now).
  const active = (isLast && ctx.taskRunning) || items.some((it) => itemActive(it, ctx));
  const pending = hasPendingApproval(items, ctx);
  const [open, setOpen] = useState(isLast);
  const userToggled = useRef(false);

  // Before any manual toggle, follow "is last segment": expanded while in progress (last
  // segment), collapsed once pushed away from the end by later messages (turn finished).
  // Deliberately not driven by per-item active — there can be a brief gap with no active item
  // between two steps within a turn, and collapsing on that basis would flicker on every step
  // and lose the internal expanded state.
  useEffect(() => {
    if (!userToggled.current) setOpen(isLast);
  }, [isLast]);

  // A pending approval must stay actionable: expand the group body regardless of collapsed state (the approval row lives inside it).
  const shown = open || pending;
  const { steps, durationMs, startMs } = summarizeWork(items);

  return (
    <div className="anim-msg my-2 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {/* Group header: a distinct title bar (solid background), on a separate layer from the step rows below it */}
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => {
          userToggled.current = true;
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900/60 dark:hover:bg-gray-800/60"
      >
        <StatusIcon state={active ? "running" : "done"} size={12} />
        {/* The title doubles as status: "Running" while in progress, "Done" when finished. */}
        <span
          className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide ${active ? "text-emerald-600 dark:text-emerald-400" : "text-gray-500 dark:text-gray-400"}`}
        >
          {active ? S.chat.workRunning : S.chat.workDone}
        </span>
        {/* A pure-thinking group (no tool calls) doesn't show "0 steps". */}
        {steps > 0 && (
          <span className="shrink-0 font-mono text-xs text-gray-400">
            {S.chat.workGroupSteps(steps)}
          </span>
        )}
        {/* Running: tick real wall time from group open (whole seconds — approval waits and
            inter-step gaps included). Done: the settled open-to-close span, with decimals. */}
        {active
          ? startMs !== undefined && (
              <span className="shrink-0 font-mono text-xs text-gray-400">
                <LiveDuration sinceMs={startMs} />
              </span>
            )
          : durationMs > 0 && (
              <span className="shrink-0 font-mono text-xs text-gray-400">
                {humanizeDuration(durationMs)}
              </span>
            )}
        {pending && !shown && (
          <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            {S.chat.approvalWaiting}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        <Chevron open={shown} className="text-gray-400" />
      </button>
      {shown && (
        <div className="anim-fade divide-y divide-gray-100 border-t border-gray-200 dark:divide-gray-800/60 dark:border-gray-800">
          {items.map((item) => (
            <MessageItem key={item.id} item={item} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}
