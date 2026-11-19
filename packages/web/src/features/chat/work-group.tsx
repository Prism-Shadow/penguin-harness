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
 * - So does a search of the region the group is in (lib/find-expand.ts): its rows are unmounted
 *   while it is closed, and a match inside them would otherwise read as no match.
 * - The duration is `summarizeWork`'s span; it ticks only while an item is in flight.
 */
import { useContext } from "react";
import {
  ActivityGroup,
  type ActivityGroupProps,
  type ActivityStepSummary,
} from "@prismshadow/penguin-ui";

import { S } from "../../lib/strings";
import { FindRevealContext } from "../../lib/find-expand";
import { approvalKey, type ChatItem } from "../../lib/amsp/stream-model";

import { useActivityAppearance } from "../../state/theme";
import { toolDisplayName } from "../../lib/tool-alias";
import { toolHeaderDetails } from "./tool-call-card";
import { toolActivity } from "./tool-activity";
import { MessageItem } from "./message-item";
import type { StreamRenderContext } from "./message-stream";
import { summarizeWork } from "./work-summary";

/**
 * Item kinds that belong in the group: thinking, tool calls, and retry notices whose ladder did
 * not give up (keeping an in-turn retry inside the work group instead of splitting it in two; a
 * ladder that gave up ended the run and stays outside at the end of the turn).
 */
export function isWorkItem(item: ChatItem): boolean {
  return (
    item.kind === "thinking" ||
    item.kind === "tool_call" ||
    (item.kind === "reconnect" && !item.gaveUp)
  );
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

/** Whether a retry notice inside the group is waiting or sending its next attempt. */
function hasWaitingRetry(items: ChatItem[]): boolean {
  return items.some((it) => it.kind === "reconnect" && !it.gaveUp && !it.retrying);
}

/** Which steps have an action the reader may need to reach from a different page. */
function needsAction(item: ChatItem, ctx: StreamRenderContext): boolean {
  if (item.kind === "reconnect") return !item.gaveUp && !item.retrying;
  return (
    item.kind === "tool_call" && ctx.pendingApprovals.has(approvalKey(ctx.origin, item.toolCallId))
  );
}

function stepSummary(
  item: ChatItem,
  ctx: StreamRenderContext,
  toolAliases: boolean,
): ActivityStepSummary | undefined {
  if (item.kind === "thinking") {
    return {
      kind: "thinking",
      label: S.chat.thinking,
      state: item.streaming ? "running" : "done",
    };
  }
  if (item.kind === "tool_call") {
    const { state, stateLabel } = toolActivity(item, needsAction(item, ctx));
    const { description, path } = toolHeaderDetails(
      item.name,
      item.argumentsText,
      !item.callStreaming,
    );
    return {
      kind: "tool",
      label: toolDisplayName(item.name, toolAliases) || S.chat.unknownTool,
      description,
      path,
      state,
      stateLabel,
    };
  }
  if (item.kind === "reconnect") {
    return {
      kind: "event",
      label: S.chat.workRetryStep(item.attempt),
      state: item.retrying ? "done" : "waiting",
    };
  }
}

/** The group's state as the package's `ActivityGroup` takes it, minus the rows. */
function useWorkGroupState(
  items: ChatItem[],
  ctx: StreamRenderContext,
  isLast: boolean,
  displayMode: ActivityGroupProps["displayMode"],
): Omit<ActivityGroupProps, "rows" | "children"> {
  // Whether any item is in flight right now — also the only window in which the group's span is
  // still growing, which the duration display depends on.
  const stepRunning = items.some((it) => itemActive(it, ctx));
  const waitingRetry = hasWaitingRetry(items);
  // Last segment + Task running = the model might still call another tool → Running, even with
  // no active item right now.
  const running = (isLast && ctx.taskRunning) || stepRunning || waitingRetry;
  // `pending` forces the body open without touching the group's own open state, so the reader's
  // choice is back once the reason is gone: an approval or retry waiting inside, or a search of
  // this region, which can only see the rows while they are mounted.
  const revealedForFind = useContext(FindRevealContext);
  const { steps, durationMs, startMs } = summarizeWork(items);
  const last = items.at(-1);
  const work =
    last && (last.kind === "thinking" || last.kind === "tool_call" || last.kind === "reconnect")
      ? last
      : undefined;
  const outcome = work?.workOutcome;
  const title =
    outcome?.state === "failed"
      ? S.chat.workFailed
      : outcome?.state === "stopped"
        ? S.chat.workStopped
        : running
          ? S.chat.workRunning
          : S.chat.workDone;
  return {
    displayMode,
    runTiming: work?.workTiming,
    terminal: outcome && { ...outcome, label: title },
    state: outcome?.state ?? (running ? "running" : "done"),
    stepRunning,
    // A group of thinking only is thinking; anything with a tool call in it is tool work.
    kind: items.some((it) => it.kind === "tool_call") ? "tool" : "thinking",
    // The title doubles as status: "Running" while in progress, "Done" when finished.
    title,
    // A pure-thinking group (no tool calls) doesn't show "0 steps".
    ...(steps > 0 ? { count: S.chat.workGroupSteps(steps) } : {}),
    ...(startMs !== undefined ? { startMs } : {}),
    durationMs,
    pending: items.some((item) => needsAction(item, ctx)) || revealedForFind,
    stepNavigation: {
      previous: S.chat.previousWorkStep,
      next: S.chat.nextWorkStep,
      latest: S.chat.latestWorkStep,
      waiting: S.chat.waitingWorkStep,
      stepWords: S.chat.workStepWords,
      jump: S.chat.workStepJump,
      elapsed: S.chat.workElapsed,
      revealAll: revealedForFind,
    },
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
  const appearance = useActivityAppearance();
  const state = useWorkGroupState(
    items,
    ctx,
    isLast,
    appearance?.activityDisplayMode ?? "standard",
  );
  return (
    <ActivityGroup
      {...state}
      rows={items.map((item) => ({
        key: item.id,
        summary: () => stepSummary(item, ctx, appearance?.toolAliases ?? false),
        needsAction: needsAction(item, ctx),
        content: <MessageItem item={item} ctx={ctx} />,
      }))}
    />
  );
}
