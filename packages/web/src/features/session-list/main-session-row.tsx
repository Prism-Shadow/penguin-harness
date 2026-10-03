import { useContext, useState, type DragEvent as ReactDragEvent } from "react";
import { withEntries, MainRowExtensions } from "./index";
import { glyphOf } from "../../lib/nav-icons";

import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import {
  CONTEXT_MENU_ACTIONS,
  HOVER_ROW_ACTIONS,
  sessionRowActions,
  type SessionRowAction,
} from "../../components/ui/session-row-menu";

import { SessionRow, toastSuccess } from "@prismshadow/penguin-ui";
import { Truncated } from "../../components/ui/truncated";
import { writeClipboard } from "../../lib/clipboard";
import { sessionActivityLabel, type SessionActivity } from "../../lib/session-activity";

import { backgroundSourceMark } from "../../lib/session-source-mark";

export function SidebarSessionRow({
  s,
  active,
  activity,
  background,
  scheduled,
  pinned,
  lastActive,
  locale,
  agentHint,
  draggable = false,
  dropEdge = null,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpen,
  onTogglePin,
  onRename,
  onMessaging,
  onDelete,
  onArchive,
}: {
  s: SessionInfo;
  active: boolean;
  /** Busy / settled-read / settled-unread / never-ran, already resolved by sessionRowActivity. */
  activity: SessionActivity;
  /** Background tasks the Session still owns (sessionBackgroundTasks); 0 draws no mark. */
  background: number;
  /** A scheduled task still to fire is bound to this Session (pendingScheduleSessions); false draws no mark. */
  scheduled: boolean;
  /** Row is pinned (bubbled to its group's top; small pin glyph on the title). */
  pinned: boolean;
  /** Preformatted compact last-active time ("" hides the slot's resting text). */
  lastActive: string;
  /** Interface language: decides the fixed width the time slot reserves (SessionRow's `timeSlot`). */
  locale: "zh" | "en";
  /** Agent display name; when set (workspace mode) a small avatar keeps the Agent context visible on the row. */
  agentHint?: string;
  /** Manual sort: the row can be drag-reordered (the sidebar wires the handlers below). */
  draggable?: boolean;
  /** Drop indicator edge while another row hovers over this one (a thin accent line above/below). */
  dropEdge?: "above" | "below" | null;
  onDragStart?: (e: ReactDragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: ReactDragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: ReactDragEvent) => void;
  onOpen: (s: SessionInfo) => void;
  onTogglePin: (s: SessionInfo) => void;
  onRename: (s: SessionInfo) => void;
  onMessaging: (s: SessionInfo) => void;
  onDelete: (s: SessionInfo) => void;
  onArchive: (s: SessionInfo) => void;
}) {
  /** Run one action on this Session (the row has closed its menu first). */
  const run = (action: SessionRowAction) => {
    const handler: Record<SessionRowAction, (x: SessionInfo) => void> = {
      pin: onTogglePin,
      rename: onRename,
      // The copy affordance's feedback normally rides on the button itself (copy-button.tsx),
      // which a menu row cannot do: the row acts and the panel closes under it. A toast is
      // the confirmation that survives that, and it says the same word — once the write
      // has landed.
      copy: (x) => {
        void writeClipboard(x.sessionId).then((ok) => ok && toastSuccess(S.common.copied));
      },
      messaging: onMessaging,
      archive: onArchive,
      delete: onDelete,
    };
    handler[action](s);
  };
  const rowState = { pinned };
  const extensions = useContext(MainRowExtensions);
  if (extensions === null) throw new Error("Session row mounted outside contributed list");
  const { rows } = extensions;
  const contributedMarks = extensions.marks(s);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const selectedEntry = rows.sessionEntries.find((entry) => entry.id === openEntry);
  const EntryDialog = selectedEntry?.Dialog;
  const menu = withEntries(
      (item) => !rows.sessionEntries.some((entry) => entry.id === item.id),
    ),
    rows.sessionEntries.map((entry) => ({
      id: entry.id,
      label: entry.label(),
      glyph: glyphOf(entry.icon),
      onSelect: () => setOpenEntry(entry.id),
    })),
  );
  return (
    <>
      {EntryDialog && <EntryDialog session={s} onClose={() => setOpenEntry(null)} />}
      <SessionRow
        sessionId={s.sessionId}
        renderTitle={(className) => (
          <Truncated
            scrollReveal
            text={s.title ?? S.chat.defaultSessionTitle}
            className={className}
          />
        )}
        active={active}
        {...(agentHint !== undefined ? { agent: { id: s.agentId, name: agentHint } } : {})}
        // The marks for the row's STANDING arrangements, all in one dim cluster: which program
        // opened it (a Session the user kept after a program opened it), how the row is filed
        // (pinned), where it can be reached from (the messaging relay, named by its channel),
        // whether it runs on its own (a scheduled task still to fire; a paused or ended one draws
        // nothing) and whether it owns work that outlives the turn (background tasks, live via
        // session_background).
        {...(backgroundSourceMark(s) ?? {})}
        {...(pinned ? { pinnedLabel: S.chat.pinnedSession } : {})}
        {...(contributedMarks.relay ? { relayLabel: contributedMarks.relay } : {})}
        {...(contributedMarks.scheduled ? { scheduledLabel: contributedMarks.scheduled } : {})}
        background={{ count: background, label: S.chat.backgroundTasks(background) }}
        activity={
          activity === null ? null : { state: activity, label: sessionActivityLabel(activity) }
        }
        approvals={{
          count: s.pendingApprovalCount,
          label: S.chat.pendingApprovals(s.pendingApprovalCount),
        }}
        time={lastActive}
        // Sized for the widest compact time each language produces — 「12月31日」 and 「59 分钟前」 in
        // zh, "Nov 30" in en.
        timeSlot={locale === "zh" ? "wide" : "narrow"}
        hoverActions={sessionRowActions(HOVER_ROW_ACTIONS, rowState, run)}
        menuActions={menu}
        moreLabel={S.chat.moreActions}
        onOpen={() => onOpen(s)}
        draggable={draggable}
        dropEdge={dropEdge}
        {...(onDragStart ? { onDragStart } : {})}
        {...(onDragEnd ? { onDragEnd } : {})}
        {...(onDragOver ? { onDragOver } : {})}
        {...(onDragLeave ? { onDragLeave } : {})}
        {...(onDrop ? { onDrop } : {})}
      />
    </>
  );
}
