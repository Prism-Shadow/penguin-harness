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
import { DISCLOSURE_CARD_CLASS } from "./disclosure-row";
import { StatusIcon } from "../../components/ui/status-icon";
import { approvalKey } from "../../lib/omni/stream-model";
import type { ChatItem } from "../../lib/omni/stream-model";
import { LiveDuration } from "./live-duration";
import { MessageItem } from "./message-item";
import type { StreamRenderContext } from "./message-stream";
import { summarizeWork } from "./work-summary";
import { toneDot, toneInk, toneSurface } from "../../lib/tone";

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
  // Whether any item is in flight right now — also the only window in which the group's span is
  // still growing, which the duration display below depends on.
  const itemsRunning = items.some((it) => itemActive(it, ctx));
  // Last segment + Task running = the model might still call another tool → show Running (even if there's no active item right now).
  const active = (isLast && ctx.taskRunning) || itemsRunning;
  const pending = hasPendingApproval(items, ctx);
  const [open, setOpen] = useState(isLast);
  const userToggled = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
    // overflow-clip (not overflow-hidden): the header below is position:sticky, and an
    // overflow-hidden ancestor is a scroll container — the header would then stick to this
    // card instead of the message list's scrollport, i.e. not stick at all. `clip` keeps
    // the exact same clipping (rounded corners included) without creating a scroll
    // container, and a sticky element never leaves its containing block, so the stuck
    // header itself is never clipped.
    <div ref={rootRef} className={DISCLOSURE_CARD_CLASS}>
      {/* Group header: a distinct title bar (solid background), on a separate layer from the
          step rows below it. Sticky against the message list's scrollport so a long expanded
          group can be collapsed from anywhere inside it — without this, finding the start of
          a long thinking/tool run means scrolling all the way back up. This is the FIRST of
          two stacked sticky levels: the currently scrolled thinking/tool row pins right
          below it at top-4 (see thinking-block.tsx / tool-call-card.tsx), so the bar
          directly above the content is always the section being read — the group header
          alone would skip a level. The background must stay fully opaque (the old dark
          900/60 read identically over the solid-900 card, but stuck over scrolling rows it
          would let them bleed through); z above the row level (z-[4]), below the stream's
          own overlays (back-to-bottom uses z-10). -top-4, not top-0: sticky offsets resolve
          against the scrollport INSIDE the scroll container's padding, so top-0 pins a py-4
          strip lower than the visible top and content scrolls through that gap; -top-4 is
          the same rem unit as the container's py-4, cancelling exactly at every font scale
          (the rows' top-4 = this offset plus the header's 2rem height, same reasoning). */}
      <button
        type="button"
        data-group-header
        aria-expanded={shown}
        onClick={() => {
          userToggled.current = true;
          // Collapsing while the header is stuck: the group's real top edge sits above the
          // fold, so after the body vanishes the viewport would land on unrelated content —
          // bring the (now header-only) group back into view once React commits. `nearest`
          // makes expanding and in-view collapsing a no-op. A forced-open pending approval
          // keeps the body (shown stays true), so that click moves nothing either.
          const willClose = open && !pending;
          setOpen((v) => !v);
          if (willClose) {
            requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "nearest" }));
          }
        }}
        className="sticky -top-4 z-[5] flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800"
      >
        <StatusIcon state={active ? "running" : "done"} />
        {/* The title doubles as status: "Running" while in progress, "Done" when finished. */}
        <span
          className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide ${active ? toneInk.busy : "text-gray-500 dark:text-gray-400"}`}
        >
          {active ? S.chat.workRunning : S.chat.workDone}
        </span>
        {/* A pure-thinking group (no tool calls) doesn't show "0 steps"; below sm the count is
            dropped entirely (title on the header carries nothing extra — the header must stay
            a single uncut line on phones). */}
        {steps > 0 && (
          <span className="hidden shrink-0 font-mono text-xs text-gray-400 sm:inline">
            {S.chat.workGroupSteps(steps)}
          </span>
        )}
        {/* Both states show the same quantity: the summarizeWork span (earliest item start →
            latest item end). That's the canonical definition here — it's what work-summary.ts
            documents, and unlike a group-open→now wall clock it is reconstructible from the
            stored timestamps, so reloading the transcript reproduces the same number. While an
            item is in flight its end isn't known yet, so the tick extends the span to *now*
            (whole seconds); with nothing in flight the value freezes at the computed span, with
            decimals — the same "don't tick through a wait we don't count" idiom as a tool card
            parked on an approval. Ticking on while the group merely stays Running (the model
            thinking between steps, or streaming its answer) would climb past the span and then
            snap backwards the moment the group settles. */}
        {itemsRunning
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
          <>
            {/* Below sm the pill collapses to a bare amber dot (title/aria carry the meaning):
                the text pill would push the header past one line on phones. role="img", not a
                live region — same non-live semantics as the text pill, so re-renders don't
                chatter at screen readers. */}
            <span
              className={`hidden shrink-0 rounded px-1 text-[10px] font-medium sm:inline ${toneSurface.attention}`}
            >
              {S.chat.approvalWaiting}
            </span>
            <span
              role="img"
              title={S.chat.approvalWaiting}
              aria-label={S.chat.approvalWaiting}
              className={`h-1.5 w-1.5 shrink-0 rounded-full sm:hidden ${toneDot.attention}`}
            />
          </>
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
