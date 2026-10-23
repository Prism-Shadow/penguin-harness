/**
 * The round navigator: a button in the panel's sticky toolbar naming the round in view, and the
 * list of every round of the file it opens, so a reader of a long Trace can reach any round from
 * anywhere in it without paging through the rows. A list row is the round's number, its
 * compaction badge, the first line of the prompt that started it, the thinking-level change in
 * muted text and its four readings in short form; a click closes the list, then draws, opens and
 * scrolls to that round. The number box in the list's header jumps by number.
 *
 * The panel is the shared `Dropdown`, portaled: outside click and Escape close it (Escape hands
 * focus back to the button), and ArrowUp/ArrowDown walk its rows. Home and End are the list's.
 * Opening lands focus on the round in view, the list's one tab stop, so Tab from the number box
 * reaches it. Its width is capped by the room between the panel's left edge and the button, so
 * the list never hangs past the panel it navigates.
 *
 * It lists all rounds — the rows below are drawn a page at a time, this list is not — so a row is
 * kept cheap: plain text, no per-row chips, and `content-visibility: auto` so the rows off the
 * list's scroll area are not laid out.
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import type { TraceTaskStats } from "@prismshadow/penguin-server/api";
import {
  Button,
  ChevronDown,
  Dropdown,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Input,
  Pill,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { Currency } from "../../state/theme";
import { roundFactsOf, roundFactsShort, roundFactsText } from "./round-facts";
import { levelChangeText } from "./trace-levels";
import type { LevelChanges } from "./trace-levels";

/** A file needs a navigator once it has this many rounds; below it every round is in reach. */
export const ROUND_NAV_MIN_ROUNDS = 2;

/** Room the panel keeps from the scroll box's left edge (px). */
const PANEL_INSET = 8;

/** A level's display name; a spelling the dictionary does not know shows as recorded. */
function levelName(level: string): string {
  return S.chat.thinkingLevelNames[level] ?? level;
}

/** The panel's width: 30rem, or the room between the scroll box's left edge and the button's right. */
function panelStyle(trigger: Element): CSSProperties {
  const right = trigger.getBoundingClientRect().right;
  const box = trigger.closest("[data-scroll-box]");
  const left = box === null ? 0 : box.getBoundingClientRect().left;
  const room = Math.max(0, right - left - PANEL_INSET);
  return { width: `min(30rem, ${room}px)`, maxWidth: "calc(100vw - 2rem)" };
}

export function RoundNavButton({
  tasks,
  toolCalls,
  levelChanges,
  badgeOf,
  currency,
  current,
  onJump,
}: {
  /** Every round of the file, in taskIndex order. */
  tasks: readonly TraceTaskStats[];
  /** Tool calls per round, by taskIndex (rounds with none are absent). */
  toolCalls: ReadonlyMap<number, number>;
  levelChanges: LevelChanges;
  /** A compaction round's badge text, null for any other round. */
  badgeOf: (st: TraceTaskStats) => string | null;
  currency: Currency;
  /** The round in view: the button's label, and the list's current row. */
  current: number;
  onJump: (taskIndex: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  // Opening lands on the round in view. A frame later, not at commit: the portaled panel is laid
  // out hidden until it has been placed, and a hidden element cannot take focus.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-nav-round="${current}"] button`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
    // Once per opening: the round in view does not change while the list holds focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    if (!open) setStyle(panelStyle(e.currentTarget));
    setOpen(!open);
  };
  const jump = (k: number) => {
    setOpen(false);
    onJump(k);
  };
  const onListKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== "Home" && e.key !== "End") return;
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-nav-round] button");
    if (!rows || rows.length === 0) return;
    e.preventDefault();
    rows[e.key === "Home" ? 0 : rows.length - 1]?.focus();
  };
  const onNumberKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const n = Number(draft);
    const target = Number.isInteger(n) ? tasks.find((t) => t.taskIndex === n - 1) : undefined;
    if (target === undefined) return;
    setDraft("");
    jump(target.taskIndex);
  };

  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      menuStyle={style}
      menuClass=""
      focusOnOpen={false}
      className="shrink-0"
      button={
        <Button
          size="sm"
          variant="ghost"
          data-slot="nav-button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          leading={<GlyphIcon d={ICONS.menu} size={ICON_SIZE.rowLead} />}
        >
          {S.traces.task(current + 1)}
          <ChevronDown className="text-fg-subtle" />
        </Button>
      }
    >
      <div role="dialog" aria-label={S.traces.roundNav}>
        <div className="flex items-center gap-2 border-b border-line-muted px-3 pb-1.5">
          <span className="text-xs font-semibold whitespace-nowrap">{S.traces.roundNav}</span>
          <span className="truncate text-xs text-fg-muted">
            {S.traces.roundCount(tasks.length)}
          </span>
          <span className="min-w-0 flex-1" />
          {/* A width given to the field itself loses to its own w-full: the box holds it. */}
          <span className="w-20 shrink-0">
            <Input
              size="sm"
              type="number"
              inputMode="numeric"
              min={1}
              max={tasks.length}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onNumberKey}
              aria-label={S.traces.jumpToRound}
              placeholder={S.traces.jumpToRoundPlaceholder}
            />
          </span>
        </div>
        <ol
          ref={listRef}
          aria-label={S.traces.roundNav}
          onKeyDown={onListKey}
          className="max-h-[60vh] overflow-y-auto pt-1"
        >
          {tasks.map((st) => {
            const k = st.taskIndex;
            const facts = roundFactsOf(st, toolCalls.get(k) ?? 0);
            const badge = badgeOf(st);
            const change = levelChanges.byRound.get(k);
            const isCurrent = k === current;
            return (
              // `content-visibility` contains the row's paint, so the focus ring is drawn inside it.
              <li
                key={k}
                data-nav-round={k}
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 28px" }}
              >
                <button
                  type="button"
                  tabIndex={isCurrent ? 0 : -1}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => jump(k)}
                  className={`flex w-full items-center gap-2 px-3 py-1 text-left text-xs whitespace-nowrap transition-colors duration-150 focus-visible:[outline-offset:-2px] ${
                    isCurrent ? "bg-control-selected" : "hover:bg-control-hover"
                  }`}
                >
                  <span className="w-8 shrink-0 text-right text-fg-subtle tabular-nums">
                    {k + 1}
                  </span>
                  {badge !== null && (
                    <span className="shrink-0">
                      <Pill>{badge}</Pill>
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-fg">{st.prompt ?? ""}</span>
                  {change !== undefined && (
                    <span
                      className="shrink-0 text-fg-subtle"
                      data-tooltip={
                        change.from === null
                          ? S.traces.levelFirst(levelName(change.to))
                          : S.traces.levelChanged(levelName(change.from), levelName(change.to))
                      }
                      data-tooltip-extra
                    >
                      {levelChangeText(change, levelName)}
                    </span>
                  )}
                  {/* The digits alone do not say which reading each is: the hint names them. */}
                  <span
                    data-tooltip={roundFactsText(facts, currency)}
                    data-tooltip-extra
                    className="shrink-0 font-mono text-fg-muted tabular-nums"
                  >
                    {roundFactsShort(facts, currency)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </Dropdown>
  );
}
