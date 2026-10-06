/**
 * The session's "Reasoning & Tools" group: binds a run of consecutive thinking and tool-call
 * items to the shared UI package's `ActivityGroup`, which draws it and owns its expand policy.
 *
 * What is decided here is the group's state, from the stream model:
 *
 * - Running vs Done: the group only counts as done once the model stops calling tools. While it
 *   is the last segment and the Task runs, the model could add another step at any moment (with
 *   a brief gap between two steps where no item is active), so it shows "Running"; it flips to
 *   "Done" once a later message pushes it away from the end, or the Task finishes. Following this
 *   rather than the per-item activity is what keeps the group from collapsing between steps.
 * - A pending approval anywhere in the group forces it open: the approval buttons live inside.
 * - The duration is `summarizeWork`'s span; it ticks only while an item is in flight.
 */
import { useSyncExternalStore } from "react";
import { ActivityGroup } from "@prismshadow/penguin-ui";
import type { ActivityGroupProps } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { readFindActive, subscribeFindActive } from "../../lib/find-expand";
import { approvalKey } from "../../lib/omni/stream-model";
import type { ChatItem } from "../../lib/omni/stream-model";
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
  // Two things force the body open regardless of the reader's own collapsed state, both because
  // the rows inside are UNMOUNTED while it is closed: a pending approval (its buttons would be
  // unreachable) and a running find (a match inside this run would be reported as no match at
  // all — lib/find-expand.ts). Neither touches the group's own open state, so the reader's
  // choice is remembered for when the reason goes away.
  const findActive = useSyncExternalStore(subscribeFindActive, readFindActive);
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
    pending: hasPendingApproval(items, ctx) || findActive,
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
