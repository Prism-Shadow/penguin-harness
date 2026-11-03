import { S } from "@prismshadow/penguin-web/internal";
import { FindRevealContext } from "@prismshadow/penguin-web/internal";
import { approvalKey, type ChatItem } from "@prismshadow/penguin-web/internal";


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

/** The group's state as the package's `ActivityGroup` takes it, minus the rows. */
export function useWorkGroupState(
  items: ChatItem[],
  ctx: StreamRenderContext,
  isLast: boolean,
): Omit<ActivityGroupProps, "rows" | "children"> {
  // Whether any item is in flight right now — also the only window in which the group's span is
  // still growing, which the duration display depends on.
  const stepRunning = items.some((it) => itemActive(it, ctx));
  // Last segment + Task running = the model might still call another tool → Running, even with
  // no active item right now.
  const running = (isLast && ctx.taskRunning) || stepRunning;
  // `pending` forces the body open without touching the group's own open state, so the reader's
  // choice is back once the reason is gone: an approval waiting inside, or a search of this
  // region, which can only see the rows while they are mounted.
  const revealedForFind = useContext(FindRevealContext);
  const { steps, durationMs, startMs } = summarizeWork(items);
  return {
    state: running ? "running" : "done",
    stepRunning,
    // A group of thinking only is thinking; anything with a tool call in it is tool work.
    kind: items.some((it) => it.kind === "tool_call") ? "tool" : "thinking",
    // The title doubles as status: "Running" while in progress, "Done" when finished.
    title: running ? S.chat.workRunning : S.chat.workDone,
    // A pure-thinking group (no tool calls) doesn't show "0 steps".
    ...(steps > 0 ? { count: S.chat.workGroupSteps(steps) } : {}),
    ...(startMs !== undefined ? { startMs } : {}),
    durationMs,
    pending: hasPendingApproval(items, ctx) || revealedForFind,
  };
}

export function SessionWorkGroup({
  items,
  ctx,
  isLast,
}: {
  items: ChatItem[];
  ctx: StreamRenderContext;
  /** Whether this group is the last segment of the message stream (current turn still in progress): decides the default expanded/collapsed state. */
  isLast: boolean;
}) {
  const state = useWorkGroupState(items, ctx, isLast);
  return (
    <ActivityGroup
      {...state}
      rows={items.map((item) => ({
        key: item.id,
        content: <MessageItem item={item} ctx={ctx} />,
      }))}
    />
  );
}
