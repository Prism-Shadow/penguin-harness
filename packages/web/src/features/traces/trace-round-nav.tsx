/**
 * The round navigator: every round of the file in one list under the global summary, so a reader
 * of a long Trace can reach any round without paging through the cards. A row is the round's
 * number, its badges (a compaction round's kind, a thinking-level change), the first line of the
 * prompt that started it and its four readings in short form; a click draws, opens and scrolls to
 * that round's card, and the box in the header jumps by number. Each round head carries a control
 * back here, to that round's row.
 *
 * It lists all rounds — the cards below are drawn a page at a time, this list is not — so a row
 * is kept cheap: plain text, no per-row chips, and `content-visibility: auto` so the rows off
 * the list's scroll area are not laid out. The list is one tab stop (a roving tabindex): Tab
 * enters it on the active row, the arrow keys, Home and End move between rows, Enter or Space
 * jumps.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import type { TraceTaskStats } from "@prismshadow/penguin-server/api";
import { Card, Chevron, Fold, Input, Pill } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { Currency } from "../../state/theme";
import { LevelPill } from "./level-pill";
import { roundFactsOf, roundFactsShort, roundFactsText } from "./round-facts";
import type { LevelChanges } from "./trace-levels";

/** A file needs a navigator once it has this many rounds; below it every card is in reach. */
export const ROUND_NAV_MIN_ROUNDS = 2;

/** The row a key moves focus to from row `i` of `n`, or null for a key the list does not handle. */
function rowAfterKey(key: string, i: number, n: number): number | null {
  switch (key) {
    case "ArrowDown":
      return Math.min(n - 1, i + 1);
    case "ArrowUp":
      return Math.max(0, i - 1);
    case "Home":
      return 0;
    case "End":
      return n - 1;
    default:
      return null;
  }
}

export function RoundNav({
  tasks,
  toolCalls,
  levelChanges,
  badgeOf,
  currency,
  open,
  current,
  active,
  onToggle,
  onActive,
  onJump,
  onRowsShown,
}: {
  /** Every round of the file, in taskIndex order. */
  tasks: readonly TraceTaskStats[];
  /** Tool calls per round, by taskIndex (rounds with none are absent). */
  toolCalls: ReadonlyMap<number, number>;
  levelChanges: LevelChanges;
  /** A compaction round's badge text, null for any other round. */
  badgeOf: (st: TraceTaskStats) => string | null;
  currency: Currency;
  open: boolean;
  /** The round last jumped to or returned from: marked `aria-current`. */
  current: number | null;
  /** The row holding the list's tab stop; null means the newest round's. */
  active: number | null;
  onToggle: () => void;
  onActive: (taskIndex: number) => void;
  onJump: (taskIndex: number) => void;
  /** The rows mounted: the navigator opened, so a pending "back" can land on its row. */
  onRowsShown?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const stop = active ?? tasks.at(-1)?.taskIndex ?? null;

  const onListKey = (e: KeyboardEvent<HTMLOListElement>) => {
    const at = (e.target as Element).closest("[data-nav-round]")?.getAttribute("data-nav-round");
    const from = tasks.findIndex((t) => t.taskIndex === Number(at ?? stop));
    const next = rowAfterKey(e.key, Math.max(0, from), tasks.length);
    if (next === null) return;
    e.preventDefault();
    const k = tasks[next]!.taskIndex;
    onActive(k);
    listRef.current?.querySelector<HTMLElement>(`[data-nav-round="${k}"] button`)?.focus();
  };

  const onNumberKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const n = Number(draft);
    const target = Number.isInteger(n) ? tasks.find((t) => t.taskIndex === n - 1) : undefined;
    if (target === undefined) return;
    setDraft("");
    onJump(target.taskIndex);
  };

  return (
    <Card padding="none" data-slot="round-nav" className="scroll-mt-3">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          data-slot="nav-toggle"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left whitespace-nowrap"
        >
          <Chevron open={open} size={13} className="text-gray-400" />
          <span className="shrink-0 text-sm font-semibold">{S.traces.roundNav}</span>
          <span className="truncate text-xs text-gray-400">
            {S.traces.roundCount(tasks.length)}
          </span>
        </button>
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
      <Fold open={open}>
        {() => (
          <NavList listRef={listRef} onKeyDown={onListKey} onShown={onRowsShown}>
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
                    tabIndex={k === stop ? 0 : -1}
                    aria-current={isCurrent ? "true" : undefined}
                    onClick={() => onJump(k)}
                    className={`flex w-full items-center gap-2 px-3 py-1 text-left text-xs whitespace-nowrap transition-colors duration-150 focus-visible:[outline-offset:-2px] ${
                      isCurrent ? "bg-control-selected" : "hover:bg-control-hover"
                    }`}
                  >
                    <span className="w-8 shrink-0 text-right text-gray-400 tabular-nums">
                      {k + 1}
                    </span>
                    {badge !== null && (
                      <span className="shrink-0">
                        <Pill>{badge}</Pill>
                      </span>
                    )}
                    {change !== undefined && (
                      <span className="shrink-0">
                        <LevelPill change={change} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">
                      {st.prompt ?? ""}
                    </span>
                    {/* The digits alone do not say which reading each is: the hint names them. */}
                    <span
                      data-tooltip={roundFactsText(facts, currency)}
                      data-tooltip-extra
                      className="shrink-0 font-mono text-gray-500 tabular-nums dark:text-gray-400"
                    >
                      {roundFactsShort(facts, currency)}
                    </span>
                  </button>
                </li>
              );
            })}
          </NavList>
        )}
      </Fold>
    </Card>
  );
}

/** The list box of rows; it says when it mounts, which is when the folded navigator opened. */
function NavList({
  listRef,
  onKeyDown,
  onShown,
  children,
}: {
  listRef: RefObject<HTMLOListElement | null>;
  onKeyDown: (e: KeyboardEvent<HTMLOListElement>) => void;
  onShown: (() => void) | undefined;
  children: ReactNode;
}) {
  // Once per mount: a later render of the same list is not an opening.
  const shown = useRef(onShown);
  useLayoutEffect(() => {
    shown.current?.();
  }, []);
  return (
    <ol
      ref={listRef}
      aria-label={S.traces.roundNav}
      onKeyDown={onKeyDown}
      className="max-h-72 divide-y divide-line-muted overflow-y-auto border-t border-line-muted"
    >
      {children}
    </ol>
  );
}
