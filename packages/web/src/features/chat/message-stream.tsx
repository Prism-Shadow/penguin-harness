/**
 * Message stream container: renders the ChatItem list; auto-sticks to the
 * bottom while streaming — an upward swipe immediately pauses follow, and scrolling back near
 * the bottom resumes it (see stream-follow.ts for the exact rule).
 * StreamRenderContext threads the pending-approval map and approval callback down to tool
 * cards at any nesting depth.
 */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import type { ChatItem } from "../../lib/omni/stream-model";
import type { TaskStats } from "../../lib/omni/task-stats";
import type { PendingApproval } from "./use-session-stream";
import { EmptyState } from "../../components/ui/empty-state";
import { MessageItem } from "./message-item";
import { WorkGroup, isWorkItem } from "./work-group";
import { createStreamFollow } from "./stream-follow";
import type { StreamFollow } from "./stream-follow";

/** Context passed down to nested rendering (pending approvals + approval submit callback + current origin chain). */
export interface StreamRenderContext {
  /** approvalKey(origin, toolCallId) → pending approval (disambiguates by origin when parent/child session tool_call_ids collide). */
  pendingApprovals: ReadonlyMap<string, PendingApproval>;
  onApprove: (toolCallId: string, decision: "allow" | "deny", origin: string[]) => Promise<void>;
  /** Origin chain at the current render level (empty array for the main session; subagent cards append one level each). */
  origin: string[];
  /**
   * Whether the Task at this level is still running (taskState for the main session, its own
   * running state for a subagent card). The "Reasoning & Tools" group uses this to decide: as
   * long as the model might still call another tool, the trailing group always shows "Running".
   */
  taskRunning: boolean;
  /** Converts this turn's stats into cost (USD) using the current Model pricing; returns null when no price is configured (cost is hidden). */
  taskCost?: (stats: TaskStats) => number | null;
  /** Opens the Files panel and navigates to this file (triggered by clicking the file-summary card at the end of a message; takes a Workspace-relative path); the card doesn't render if this isn't wired up. */
  onOpenFile?: (path: string) => void;
  /** Absolute Workspace path of the current Session (used by the file-summary card to normalize body paths). */
  workspace?: string | null;
  /** Batch file-existence check (with session-level caching); the card doesn't render if this isn't wired up. */
  statFiles?: (paths: string[]) => Promise<ReadonlySet<string>>;
}

/** Pure list rendering (reused recursively inside subagent cards): consecutive thinking + tool-call items are aggregated into one "Reasoning & Tools" group. */
export function MessageItems({ items, ctx }: { items: ChatItem[]; ctx: StreamRenderContext }) {
  // Split into segments first — group (consecutive thinking + tool calls) or single (everything
  // else) — then render. WorkGroup needs to know whether it's the last segment (current turn
  // still in progress) to decide its default expanded/collapsed state.
  type Seg = { type: "group"; items: ChatItem[] } | { type: "single"; item: ChatItem };
  const segs: Seg[] = [];
  let run: ChatItem[] = [];
  const flushRun = () => {
    if (run.length > 0) {
      segs.push({ type: "group", items: run });
      run = [];
    }
  };
  for (const item of items) {
    if (isWorkItem(item)) run.push(item);
    else {
      flushRun();
      segs.push({ type: "single", item });
    }
  }
  flushRun();

  const renderSeg = (seg: Seg, i: number): ReactNode =>
    seg.type === "group" ? (
      <WorkGroup
        key={`wg-${seg.items[0]!.id}`}
        items={seg.items}
        ctx={ctx}
        isLast={i === segs.length - 1}
      />
    ) : (
      <MessageItem key={seg.item.id} item={seg.item} ctx={ctx} />
    );

  /**
   * Each turn's AI-side content (reply, reasoning-and-tools group, compaction banner, ...) plus
   * its trailing stats row shares a single group container. The stats row is that turn's footer
   * (timestamp and copy button live there, and the whole row is transparent by default), so
   * hovering **any** content within the turn must be able to reveal it.
   *
   * The stats row can't simply be paired with the adjacent assistant reply — if compaction
   * happens mid-turn, the compaction banner gets inserted between them (items:
   * assistant_text → compaction → task_stats), breaking the pairing instantly. The stats row
   * would then become a strip that's both invisible and unhoverable (the element's own `group`
   * class doesn't apply to itself: group-hover is a descendant selector).
   *
   * The container is created as soon as the turn's **first** segment appears, keyed by that
   * segment's id, and the key never changes afterward. If we waited for the stats row to arrive
   * before moving already-rendered groups into a new container, React would treat it as a
   * position change — unmount and remount — and the WorkGroup and tool-card expanded states
   * (each backed by its own internal useState) would reset instantly: any tool details the user
   * had manually expanded would collapse the moment the reply finishes.
   *
   * User messages never enter this container: they have their own footer, and including them
   * would make hovering a user message also light up the AI's stats row.
   */
  const nodes: ReactNode[] = [];
  let turn: { seg: Seg; i: number }[] = [];
  const flushTurn = () => {
    if (turn.length === 0) return;
    const first = turn[0]!.seg;
    const key = first.type === "group" ? first.items[0]!.id : first.item.id;
    const body = turn;
    turn = [];
    nodes.push(
      <div key={`turn-${key}`} className="group">
        {body.map((t) => renderSeg(t.seg, t.i))}
      </div>,
    );
  };

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const isUserMsg =
      seg.type === "single" && (seg.item.kind === "user_text" || seg.item.kind === "user_image");
    if (isUserMsg) {
      flushTurn();
      nodes.push(renderSeg(seg, i));
      continue;
    }
    turn.push({ seg, i });
    // Stats row = end of this turn; seal the container here. Anything after belongs to the next turn.
    if (seg.type === "single" && seg.item.kind === "task_stats") flushTurn();
  }
  flushTurn(); // Turn not yet finished (stats row hasn't arrived): container already exists, subsequent content is appended directly

  return <>{nodes}</>;
}

export function MessageStream({
  items,
  version,
  ctx,
}: {
  items: ChatItem[];
  /** View-model version number (a repaint signal for in-place updates that also drives auto-scroll). */
  version: number;
  ctx: StreamRenderContext;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // An upward-swipe intent immediately exits auto-follow; scrolling back near the bottom resumes it — see stream-follow.ts (#75) for the exact rule.
  const followRef = useRef<StreamFollow | null>(null);
  const follow = (followRef.current ??= createStreamFollow());

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    follow.scrolled({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && follow.stick) el.scrollTop = el.scrollHeight;
  }, [version, follow]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onWheel={(e) => follow.wheel(e.deltaY)}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t) follow.touchStart(t.clientY);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t) follow.touchMove(t.clientY);
      }}
      onTouchEnd={() => follow.touchEnd()}
      className="anim-fade h-full overflow-y-auto px-4 py-4 md:px-6"
    >
      <div className="mx-auto max-w-3xl">
        {items.length === 0 ? (
          <EmptyState title={S.chat.emptyStream} />
        ) : (
          <MessageItems items={items} ctx={ctx} />
        )}
      </div>
    </div>
  );
}
