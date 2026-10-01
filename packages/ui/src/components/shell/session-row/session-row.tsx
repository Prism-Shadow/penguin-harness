/**
 * A conversation's row in the sidebar's list, and the hover actions it shares with the other
 * conversation rows.
 *
 * The row is the title — with an agent's avatar before it where the group does not name the
 * agent — the marks of its standing arrangements, its live state and its waiting approvals, and a
 * trailing slot that swaps what it shows: the compact last-active time at rest, and on hover or
 * focus the direct actions and the "more" button that opens the whole set as a menu. The same
 * menu opens at the pointer on a right-click, from the keyboard with Shift+F10, and on touch with
 * a press-and-hold (`useRowContextMenu`, whose handlers the row spreads); a hold's replayed click
 * does not also open the conversation. Both panels go through the dropdown's body portal, so the
 * sidebar's scroller cannot clip them.
 *
 * Every mark after the title names itself, in a hint and in visually hidden text, which is what
 * lets the standing ones recede to the subtle ink: pinned, relayed to a messaging channel,
 * scheduled to run on its own, and work still running in the background. The live state (a
 * turning hourglass, the compress mark, the unread dot) has one reserved box, kept empty when
 * there is nothing to show, so the title never re-flows as a run starts, finishes and is read.
 *
 * The title is the caller's to draw, with the classes the row hands `renderTitle`: the row
 * decides the ink and the weight, the caller its own truncation — the app's line reveals a
 * clipped tail by scrolling it while the row is hovered or focused, keyed on the row's
 * `data-title-reveal`. The trailing slot's width is fixed per language (`timeSlot`), so the marks
 * that end the title sit at one x from row to row, and the hover actions are anchored to its right
 * edge so every row's icons form one column.
 */
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import {
  ActivityIcon,
  BackgroundTasksMark,
  ScheduleMark,
} from "../../icons/activity-icon/activity-icon";
import type { ActivityIconState } from "../../icons/activity-icon/activity-icon";
import { AgentAvatar } from "../../icons/avatars/agent-avatar";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { NAV_FILL } from "../../navigation/nav-list/nav-list";
import { Dropdown } from "../../overlays/dropdown/dropdown";
import { MenuItem } from "../../overlays/menu/menu";
import type { AnchorRect } from "../../overlays/portal-panel/context-menu";
import { useRowContextMenu } from "../../overlays/portal-panel/use-row-context-menu";

/** One thing a row can do to what it stands for, as its hover button or its menu row draw it. */
export interface RowActionItem {
  /** Stable within the row. */
  id: string;
  /** The label in the row's current state: the menu row's words, the hover button's name. */
  label: string;
  /** The glyph's path, from the icon registry. */
  glyph: string;
  /** Destructive: the danger ink on the menu row and on the hover button's hover. */
  danger?: boolean;
  onSelect: () => void;
}

/** A hover button's glyph: a notch under the icon-button rung, sized to the row's 24px buttons. */
export const ROW_ACTION_GLYPH = 14;

/**
 * The hover buttons: the reveal is gated on pointer events exactly as on opacity, because an
 * invisible button still takes taps, and on a touch screen — where `hover:` never matches — these
 * are invisible for the whole session. Keyboard focus is unaffected by `pointer-events`, so Tab
 * still reaches them, and revealing one re-arms its click. `focus` rather than `focus-visible`:
 * the time they swap with hides on plain focus-within, and the two must agree or the slot goes
 * blank. The sidebar's nav entries draw their pin toggle with the same look (sidebar-frame.tsx).
 */
export const ROW_HOVER_BUTTON =
  "pointer-events-none flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-fg-subtle opacity-0 transition-[color,opacity] duration-150 focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100";

/**
 * A row's hover affordance: its direct actions as icon buttons that fade in over the row's end,
 * then the "more" button that opens the row's menu anchored at its own box, so every menu action
 * is one visible click away rather than right-click only. Hover and focus only — desktop — since
 * a touch screen reaches the same menu by holding the row. The row that holds them carries the
 * `group` scope.
 */
export function RowHoverActions({
  actions,
  moreLabel,
  onMore,
}: {
  actions: readonly RowActionItem[];
  /** The "more" button's name and hint. */
  moreLabel: string;
  /** Opens the row's menu anchored at the "more" button's own box. */
  onMore: (anchor: AnchorRect) => void;
}) {
  const openMore = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onMore({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  };
  return (
    <>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          data-tooltip={action.label}
          aria-label={action.label}
          onClick={action.onSelect}
          className={`${ROW_HOVER_BUTTON} ${
            action.danger === true ? "hover:text-tone-danger-fg" : "hover:text-fg"
          }`}
        >
          <GlyphIcon d={action.glyph} size={ROW_ACTION_GLYPH} />
        </button>
      ))}
      <button
        type="button"
        data-tooltip={moreLabel}
        aria-label={moreLabel}
        aria-haspopup="menu"
        onClick={openMore}
        className={`${ROW_HOVER_BUTTON} hover:text-fg`}
      >
        {/* Hairline-stroke dots vanish at this size, so the ellipsis is drawn filled: the stroke
            rides on top of the fill, landing the dots at the other glyphs' weight. */}
        <GlyphIcon d={ICONS.ellipsis} size={ROW_ACTION_GLYPH} filled />
      </button>
    </>
  );
}

/** A standing arrangement's mark after the title: the glyph, its hint, and its words for a reader. */
function RowMark({ glyph, label }: { glyph: string; label: string }) {
  return (
    <span data-tooltip={label} className="shrink-0 text-fg-subtle">
      <GlyphIcon d={glyph} size={ICON_SIZE.rowMark} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The live state's box: its glyph, or the same box empty, so the title never re-flows. */
function StatusSlot({
  activity,
}: {
  activity: { state: ActivityIconState; label: string } | null;
}) {
  if (activity === null) return <span aria-hidden="true" className="block h-3 w-3 shrink-0" />;
  return <ActivityIcon activity={activity.state} label={activity.label} />;
}

export interface SessionRowProps {
  /** The conversation's id, written on the row's button for tests and for the app to find it. */
  sessionId: string;
  /** Draws the title line with the classes the row hands over (its ink and weight). */
  renderTitle: (className: string) => ReactNode;
  /** The open conversation: the selected wash and the title's medium weight. */
  active?: boolean;
  /** Archived: the title recedes to the subtle ink. */
  archived?: boolean;
  /** The conversation's agent, as a small avatar before the title (where its group is not the agent). */
  agent?: { id: string; name: string };
  /** Pinned to the top of its list: the pin mark, named by this. */
  pinnedLabel?: string;
  /** Relayed to a messaging channel: the paper plane, named by this (the channel's name). */
  relayLabel?: string;
  /** A scheduled task will run it: the alarm clock, named by this. */
  scheduledLabel?: string;
  /** Background work it owns is still running: the pulse, named by `label`; none at a count of 0. */
  background?: { count: number; label: string };
  /** Its live state; null (or omitted) keeps the box empty. */
  activity?: { state: ActivityIconState; label: string } | null;
  /** Approvals waiting: the count in the attention ink, its hint; none at a count of 0. */
  approvals?: { count: number; label: string };
  /** The compact last-active time at rest; "" draws none. */
  time: string;
  /**
   * The width the trailing slot reserves, fixed per language: `wide` where the longest compact
   * time runs longer ("12月31日", "59 分钟前"), `narrow` otherwise ("Nov 30").
   */
  timeSlot?: "narrow" | "wide";
  /** The direct actions the hover reveals, before the "more" button. */
  hoverActions: readonly RowActionItem[];
  /** The whole set, in the menu the "more" button, a right-click, Shift+F10 or a hold opens. */
  menuActions: readonly RowActionItem[];
  /** The "more" button's name and hint. */
  moreLabel: string;
  onOpen: () => void;
  /** Manual order: the row can be dragged (the caller wires the handlers). */
  draggable?: boolean;
  /** While another row is dragged over this one: the edge the drop would land on. */
  dropEdge?: "above" | "below" | null;
  onDragStart?: (e: ReactDragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: ReactDragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: ReactDragEvent) => void;
}

export function SessionRow({
  sessionId,
  renderTitle,
  active = false,
  archived = false,
  agent,
  pinnedLabel,
  relayLabel,
  scheduledLabel,
  background,
  activity = null,
  approvals,
  time,
  timeSlot = "narrow",
  hoverActions,
  menuActions,
  moreLabel,
  onOpen,
  draggable = false,
  dropEdge = null,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: SessionRowProps) {
  const ctx = useRowContextMenu();
  /** A hover button closes an open menu before it acts. */
  const fromHover = (action: RowActionItem): RowActionItem => ({
    ...action,
    onSelect: () => {
      ctx.close();
      action.onSelect();
    },
  });
  /**
   * A menu row hands focus back to the row before acting: the panel unmounts under the reader,
   * and the menu is the only keyboard route to some actions, so a Shift+F10 → Enter reader would
   * otherwise land on the page's body and lose their place in the list. An action that opens a
   * dialog takes focus from there as usual.
   */
  const fromMenu = (action: RowActionItem) => () => {
    ctx.returnFocus()?.focus();
    ctx.close();
    action.onSelect();
  };
  const titleInk = active ? "font-medium text-fg" : archived ? "text-fg-subtle" : "text-fg/80";
  return (
    <li
      className="relative"
      {...(draggable
        ? { draggable: true, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }
        : {})}
    >
      {/* The drop line: a thin accent rule on the edge a dragged row would land on. */}
      {dropEdge !== null && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-accent ${
            dropEdge === "above" ? "-top-px" : "-bottom-px"
          }`}
        />
      )}
      <div
        data-title-reveal
        ref={ctx.rowRef}
        // Right-click, Shift+F10 and press-and-hold open the row's menu; the browser's own menu
        // is suppressed on this row only. select-none keeps a held press from raising the text
        // selection callout on touch instead of the menu.
        {...ctx.rowProps}
        className={`group flex select-none items-center rounded-md pr-1 transition-colors duration-150 ${
          draggable ? "cursor-grab " : ""
        }${active ? NAV_FILL.selected : NAV_FILL.hover}`}
      >
        <button
          type="button"
          data-testid="session-row"
          data-session-id={sessionId}
          // A press-and-hold that opened the menu must not also open the conversation: touch
          // screens replay the held press as a click once the finger lifts.
          onClick={() => {
            if (ctx.consumeLongPressClick()) return;
            onOpen();
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left"
        >
          {agent !== undefined && (
            <span data-tooltip={agent.name} className="flex shrink-0 items-center">
              <AgentAvatar
                id={agent.id}
                name={agent.name}
                size={ICON_SIZE.rowLead}
                className="rounded-sm"
              />
              {/* The avatar is hidden from assistive technology and the hint serves pointers only:
                  the agent's name reaches everyone else as hidden text inside the row's button. */}
              <span className="sr-only">{agent.name}</span>
            </span>
          )}
          {renderTitle(`min-w-0 flex-1 font-sans text-sm ${titleInk}`)}
          {pinnedLabel !== undefined && <RowMark glyph={ICONS.pin} label={pinnedLabel} />}
          {relayLabel !== undefined && <RowMark glyph={ICONS.paperPlane} label={relayLabel} />}
          {scheduledLabel !== undefined && (
            <ScheduleMark label={scheduledLabel} size={ICON_SIZE.rowMark} />
          )}
          {background !== undefined && background.count > 0 && (
            <BackgroundTasksMark label={background.label} size={ICON_SIZE.rowMark} />
          )}
          <StatusSlot activity={activity} />
          {/* A numeral in the attention ink, with no pill: a filled chip beside the title reads as
              a second button. */}
          {approvals !== undefined && approvals.count > 0 && (
            <span
              data-tooltip={approvals.label}
              className="shrink-0 text-xs font-semibold tabular-nums text-tone-attention-fg"
            >
              {approvals.count}
            </span>
          )}
        </button>
        {/* The trailing slot: the time at rest, the hover actions over it. Its width is fixed so
            the marks before it hold one x from row to row; the actions are a constant-width
            group anchored at its right edge, so their glyphs form one column; the swap is an
            opacity handoff (the actions precede the time, so the peer rule can reach it). */}
        <div
          className={`relative flex h-6 shrink-0 items-center justify-end ${
            timeSlot === "wide" ? "w-[4.5rem]" : "w-14"
          }`}
        >
          <div className="peer absolute right-0 top-1/2 flex -translate-y-1/2 items-center">
            <RowHoverActions
              actions={hoverActions.map(fromHover)}
              moreLabel={moreLabel}
              onMore={ctx.openAt}
            />
          </div>
          {time !== "" && (
            <span
              aria-hidden
              className="pointer-events-none whitespace-nowrap px-1 text-right text-xs tabular-nums text-fg-subtle transition-opacity duration-150 group-hover:opacity-0 peer-focus-within:opacity-0"
            >
              {time}
            </span>
          )}
        </div>
        {/* The menu. `contents` keeps this wrapper out of the row's layout: the panel is
            portaled, and its anchor is the point the gesture landed on (or the "more" button's
            box), not this element. */}
        <Dropdown
          open={ctx.open}
          setOpen={ctx.setOpen}
          portal={{ direction: "down", align: "left" }}
          anchorRect={ctx.anchor}
          anchorOwner={ctx.anchorOwner}
          returnFocus={ctx.returnFocus}
          className="contents"
          menuClass="w-36"
          button={null}
        >
          {menuActions.map((action) => (
            <MenuItem
              key={action.id}
              density="sm"
              glyph={action.glyph}
              label={action.label}
              danger={action.danger === true}
              onSelect={fromMenu(action)}
            />
          ))}
        </Dropdown>
      </div>
    </li>
  );
}
