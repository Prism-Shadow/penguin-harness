/**
 * The per-task grid: one column per entry (best first), one row per task grouped under its
 * benchmark, and in each cell that entry's attempts on that task as squares side by side, shaded
 * by score on a single-hue ramp. Each column head carries its entry's colour; every name keeps to
 * one line, cut short with the whole name on hover. Task and benchmark names link to their pages
 * (a draft benchmark has none, so its names stay text). On a narrow screen
 * the grid scrolls sideways inside its panel with the task column held in place, so its focus ring
 * is drawn inside its edge, where the scroll box does not clip it.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";
import { Link } from "react-router";
import type { LeaderboardEntry, WaffleGrid, WaffleTask } from "../../../lib/hub/types";
import { formatScore } from "../../../lib/hub/text";
import { S } from "../../../lib/strings";
import { Readout, labelsOf, useWidth } from "./chart-kit";
import type { Anchor } from "./chart-kit";
import type { EntryColour } from "./entry-colour";
import type { NameOf } from "./entry-name";
import { Dot } from "./score-table";

/**
 * Four score bands, 0–25 up to 75–100, light to dark on white and dark to light on the dark
 * canvas. The steps sit evenly apart in lightness, and the low end stays at least 2:1 against
 * its canvas so a score of 0 still reads as a mark.
 */
const STEPS = [
  "fill-brand-300 dark:fill-brand-800",
  "fill-brand-600 dark:fill-brand-600",
  "fill-brand-800 dark:fill-brand-300",
  "fill-brand-950 dark:fill-brand-100",
] as const;
const EMPTY = "fill-none stroke-gray-300 dark:stroke-gray-600";

const stepOf = (score: number) =>
  STEPS[Math.max(0, Math.min(STEPS.length - 1, Math.floor(score / (100 / STEPS.length))))]!;

const SIZE = 12;
const GAP = 2;
/** The task column and its group headers stay put while the grid scrolls; they need the panel's own fill. */
const STICKY = "sticky left-0 z-[1] bg-white dark:bg-gray-900";

interface Cell {
  /** Task index, in `grid.tasks` order. */
  task: number;
  /** Column index, best entry first. */
  col: number;
}

export function WaffleChart({
  entries,
  grid,
  nameOf,
  taskTitles,
  benchmarkTitle,
  benchmarkListed,
  colourOf,
}: {
  entries: readonly LeaderboardEntry[];
  grid: WaffleGrid;
  nameOf: NameOf;
  taskTitles: Record<string, string>;
  benchmarkTitle: (id: string) => string;
  benchmarkListed: (id: string) => boolean;
  colourOf: (entry: LeaderboardEntry) => EntryColour;
}) {
  const t = S.hub.leaderboards;
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const cells = useRef(new Map<string, HTMLTableCellElement>());
  const scroller = useRef<HTMLDivElement>(null);
  /** The part of the grid in view, so a readout stays inside it while the grid scrolls sideways. */
  const [view, setView] = useState({ left: 0, width: 0 });
  const measureView = () => {
    const element = scroller.current;
    if (element) setView({ left: element.scrollLeft, width: element.clientWidth });
  };
  const [active, setActive] = useState<Cell | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const ranked = entries
    .map((entry, index) => ({ entry, index, scores: grid.rows[index]?.scores ?? [] }))
    .sort((a, b) => b.entry.value - a.entry.value || a.index - b.index);
  const labels = labelsOf(
    ranked.map((row) => row.entry),
    nameOf,
  );
  const tasks = grid.tasks;
  const attempts = Math.max(1, ...ranked.flatMap((row) => row.scores.map((s) => s.length)));
  const hasEmpty = ranked.some((row) =>
    tasks.some((_, k) => (row.scores[k]?.length ?? 0) < attempts),
  );

  const fullTitle = (task: WaffleTask) =>
    task.taskIds
      .map((id) => taskTitles[`${task.benchmarkId}/${id}`] ?? id)
      .join(S.hub.listSeparator);
  /** Consecutive tasks of one benchmark, with the "<Benchmark>: " prefix their titles share dropped. */
  const groups: { benchmarkId: string; items: { k: number; short: string }[] }[] = [];
  tasks.forEach((task, k) => {
    const last = groups.at(-1);
    if (last && last.benchmarkId === task.benchmarkId) last.items.push({ k, short: "" });
    else groups.push({ benchmarkId: task.benchmarkId, items: [{ k, short: "" }] });
  });
  for (const group of groups) {
    const titles = group.items.map(({ k }) => fullTitle(tasks[k]!));
    const prefix = /^[^:]+:\s+/.exec(titles[0] ?? "")?.[0];
    const shared = prefix !== undefined && titles.every((title) => title.startsWith(prefix));
    group.items.forEach((item, i) => {
      item.short = shared ? titles[i]!.slice(prefix.length) : titles[i]!;
    });
  }

  useLayoutEffect(() => {
    const cell = active ? cells.current.get(`${active.task}:${active.col}`) : undefined;
    const wrap = wrapRef.current;
    if (!active || !cell || !wrap) {
      setAnchor(null);
      return;
    }
    const box = cell.getBoundingClientRect();
    const frame = wrap.getBoundingClientRect();
    setAnchor({
      x: box.left - frame.left + box.width / 2,
      top: box.top - frame.top + 2,
      bottom: box.bottom - frame.top - 2,
    });
    measureView();
  }, [active, width, wrapRef]);

  const describe = ({ task, col }: Cell) => {
    const scores = ranked[col]?.scores[task] ?? [];
    const parts = Array.from({ length: attempts }, (_, a) =>
      scores[a] === undefined ? t.noScore : formatScore(scores[a]),
    );
    return t.cellScores(parts);
  };

  const pick = (cell: Cell, toggle: boolean) => {
    if (toggle && active?.task === cell.task && active.col === cell.col) setActive(null);
    else setActive(cell);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = active ?? { task: 0, col: 0 };
    const last = { task: tasks.length - 1, col: ranked.length - 1 };
    const moves: Record<string, Cell | null> = {
      ArrowRight: { ...at, col: Math.min(last.col, at.col + 1) },
      ArrowLeft: { ...at, col: Math.max(0, at.col - 1) },
      ArrowDown: { ...at, task: Math.min(last.task, at.task + 1) },
      ArrowUp: { ...at, task: Math.max(0, at.task - 1) },
      Home: { ...at, col: 0 },
      End: { ...at, col: last.col },
      PageDown: { ...at, task: last.task },
      PageUp: { ...at, task: 0 },
      Escape: null,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = moves[event.key]!;
    setActive(next);
    if (next) {
      cells.current
        .get(`${next.task}:${next.col}`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (active === null && event.currentTarget.matches(":focus-visible")) {
      setActive({ task: 0, col: 0 });
    }
  };

  if (tasks.length === 0 || ranked.length === 0) return null;

  const swatch = 10;
  const cellWidth = attempts * (SIZE + GAP) - GAP;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <span>{t.scale}</span>
          <span className="tabular-nums">0</span>
          <svg
            aria-hidden
            width={STEPS.length * (swatch + GAP) - GAP}
            height={swatch}
            className="shrink-0"
          >
            {STEPS.map((step, k) => (
              <rect
                key={step}
                x={k * (swatch + GAP)}
                width={swatch}
                height={swatch}
                rx="2"
                className={step}
              />
            ))}
          </svg>
          <span className="tabular-nums">100</span>
        </div>
        {hasEmpty && (
          <div className="flex items-center gap-2">
            <svg aria-hidden width={swatch} height={swatch} className="shrink-0">
              <rect
                x="0.5"
                y="0.5"
                width={swatch - 1}
                height={swatch - 1}
                rx="2"
                className={EMPTY}
              />
            </svg>
            {t.noScore}
          </div>
        )}
        <span>{t.attemptsPerCell(attempts)}</span>
      </div>

      <div ref={scroller} onScroll={measureView} className="mt-4 overflow-x-auto">
        <div
          ref={wrapRef}
          role="group"
          tabIndex={0}
          aria-label={t.charts.waffle}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setActive(null);
          }}
          className="relative w-max min-w-full rounded-sm focus-visible:outline-[3px] focus-visible:-outline-offset-[3px] focus-visible:outline-gray-500/40"
        >
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className={`${STICKY} pr-3 pb-2 text-left align-bottom text-xs font-medium text-gray-500 dark:text-gray-400`}
                >
                  {t.task}
                </th>
                {ranked.map((row, col) => (
                  <th
                    key={`${row.entry.key}:${row.index}`}
                    scope="col"
                    className="px-2 pb-2 text-center align-bottom text-xs font-medium"
                  >
                    <span className="mx-auto flex max-w-28 items-center justify-center gap-1.5 sm:max-w-44">
                      <Dot colour={colourOf(row.entry)} />
                      <span
                        title={labels[col]}
                        className="min-w-0 truncate text-gray-900 dark:text-gray-100"
                      >
                        {labels[col]}
                      </span>
                    </span>
                    <span className="block text-gray-500 tabular-nums dark:text-gray-400">
                      {formatScore(row.entry.value)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.benchmarkId}>
                <tr>
                  <th
                    scope="rowgroup"
                    className={`${STICKY} border-t border-gray-100 pt-3 pr-3 pb-1 text-left text-xs font-medium dark:border-gray-800`}
                  >
                    {benchmarkListed(group.benchmarkId) ? (
                      <Link
                        to={`/benchmarks/${group.benchmarkId}`}
                        title={benchmarkTitle(group.benchmarkId)}
                        className="block max-w-32 truncate text-gray-900 hover:underline sm:max-w-80 dark:text-gray-100"
                      >
                        {benchmarkTitle(group.benchmarkId)}
                      </Link>
                    ) : (
                      <span
                        title={benchmarkTitle(group.benchmarkId)}
                        className="block max-w-32 truncate text-gray-900 sm:max-w-80 dark:text-gray-100"
                      >
                        {benchmarkTitle(group.benchmarkId)}
                      </span>
                    )}
                  </th>
                  <td
                    colSpan={ranked.length}
                    className="border-t border-gray-100 dark:border-gray-800"
                  />
                </tr>
                {group.items.map(({ k, short }) => {
                  const task = tasks[k]!;
                  const full = fullTitle(task);
                  return (
                    <tr key={k}>
                      <th scope="row" className={`${STICKY} py-0.5 pr-3 text-left font-normal`}>
                        {benchmarkListed(task.benchmarkId) ? (
                          <Link
                            to={`/benchmarks/${task.benchmarkId}#${encodeURIComponent(task.taskIds[0] ?? "")}`}
                            title={full}
                            className="block max-w-32 truncate text-gray-700 underline decoration-gray-300 underline-offset-4 hover:decoration-gray-500 sm:max-w-80 dark:text-gray-300 dark:decoration-gray-700"
                          >
                            {short}
                          </Link>
                        ) : (
                          <span
                            title={full}
                            className="block max-w-32 truncate text-gray-700 sm:max-w-80 dark:text-gray-300"
                          >
                            {short}
                          </span>
                        )}
                      </th>
                      {ranked.map((row, col) => {
                        const scores = row.scores[k] ?? [];
                        const on = active?.task === k && active.col === col;
                        return (
                          <td
                            key={`${row.entry.key}:${row.index}`}
                            ref={(element) => {
                              const key = `${k}:${col}`;
                              if (element) cells.current.set(key, element);
                              else cells.current.delete(key);
                            }}
                            className="px-2 py-0.5 text-center"
                            onPointerEnter={(event) => {
                              if (event.pointerType === "mouse") pick({ task: k, col }, false);
                            }}
                            onPointerDown={(event) => {
                              if (event.pointerType !== "mouse") pick({ task: k, col }, true);
                            }}
                          >
                            <svg
                              aria-hidden
                              width={cellWidth + 4}
                              height={SIZE + 4}
                              className="inline-block align-middle"
                            >
                              {Array.from({ length: attempts }, (_, a) => {
                                const score = scores[a];
                                const x = 2 + a * (SIZE + GAP);
                                return score === undefined ? (
                                  <rect
                                    key={a}
                                    x={x + 0.5}
                                    y={2.5}
                                    width={SIZE - 1}
                                    height={SIZE - 1}
                                    rx="2"
                                    className={EMPTY}
                                  />
                                ) : (
                                  <rect
                                    key={a}
                                    x={x}
                                    y={2}
                                    width={SIZE}
                                    height={SIZE}
                                    rx="2"
                                    className={stepOf(score)}
                                  />
                                );
                              })}
                              {on && (
                                <rect
                                  x="0.75"
                                  y="0.75"
                                  width={cellWidth + 2.5}
                                  height={SIZE + 2.5}
                                  rx="3"
                                  fill="none"
                                  strokeWidth="1.5"
                                  className="stroke-gray-900 dark:stroke-gray-100"
                                />
                              )}
                            </svg>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
          {active && anchor && (
            <Readout
              id={`${active.task}:${active.col}`}
              anchor={anchor}
              start={view.left}
              bound={view.width > 0 ? Math.min(width, view.left + view.width) : width}
            >
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {labels[active.col]}
              </div>
              <div>{fullTitle(tasks[active.task]!)}</div>
              <div className="tabular-nums">{describe(active)}</div>
            </Readout>
          )}
          <p aria-live="polite" className="sr-only">
            {active
              ? `${labels[active.col]}, ${fullTitle(tasks[active.task]!)}: ${describe(active)}`
              : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
