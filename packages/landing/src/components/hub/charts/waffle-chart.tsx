/**
 * The per-task chart (waffle.yaml): one band per entry, best first. Each task is a column of
 * squares, one per attempt, shaded by its score on a single-hue ramp; columns line up across the
 * bands, and wrap onto more lines when the squares would get too small to point at.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, PointerEvent } from "react";
import type { WaffleChart as WaffleData, WaffleTask } from "../../../lib/hub/types";
import { formatScore } from "../../../lib/hub/text";
import { S } from "../../../lib/strings";
import { CHART_FOCUS, Readout, labelsOf, useWidth } from "./chart-kit";
import type { Anchor } from "./chart-kit";
import type { NameOf } from "./entry-name";

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

const GAP = 2;
const MAX_SIZE = 16;
/** Below this the squares wrap onto more lines instead of shrinking further. */
const MIN_SIZE = 8;
const WRAP_SIZE = 10;
const LINE_GAP = 8;
const LABEL_WIDTH = 144;
const LABEL_GAP = 16;
/** From this width the method sits beside its band; below it, above. */
const SIDE_LABELS = 560;

interface Cell {
  row: number;
  task: number;
  attempt: number;
}

export function WaffleChart({
  chart,
  nameOf,
  taskTitles,
}: {
  chart: WaffleData;
  nameOf: NameOf;
  taskTitles: Record<string, string>;
}) {
  const t = S.hub.leaderboards;
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const bands = useRef<(SVGSVGElement | null)[]>([]);
  const [active, setActive] = useState<Cell | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const ranked = chart.entries
    .map((entry, index) => ({ entry, index, scores: chart.rows[index]?.scores ?? [] }))
    .sort((a, b) => b.entry.value - a.entry.value || a.index - b.index);
  const labels = labelsOf(
    ranked.map((row) => row.entry),
    nameOf,
  );
  const tasks = chart.tasks;
  const attempts = Math.max(1, ...ranked.flatMap((row) => row.scores.map((s) => s.length)));
  const hasEmpty = ranked.some((row) =>
    tasks.some((_, k) => (row.scores[k]?.length ?? 0) < attempts),
  );

  const side = width >= SIDE_LABELS;
  const room = Math.max(0, side ? width - LABEL_WIDTH - LABEL_GAP : width);
  let size = Math.floor((room + GAP) / Math.max(1, tasks.length)) - GAP;
  let perLine = tasks.length;
  if (size < MIN_SIZE) {
    size = WRAP_SIZE;
    const fit = Math.max(1, Math.floor((room + GAP) / (size + GAP)));
    perLine = Math.ceil(tasks.length / Math.ceil(tasks.length / fit));
  }
  size = Math.min(size, MAX_SIZE);
  const pitch = size + GAP;
  const lines = Math.ceil(tasks.length / Math.max(1, perLine));
  const lineHeight = attempts * pitch - GAP;
  const bandWidth = perLine * pitch - GAP;
  const bandHeight = lines * (lineHeight + LINE_GAP) - LINE_GAP;
  const cellAt = (task: number, attempt: number) => ({
    x: (task % perLine) * pitch,
    y: Math.floor(task / perLine) * (lineHeight + LINE_GAP) + attempt * pitch,
  });

  useLayoutEffect(() => {
    const svg = active ? bands.current[active.row] : null;
    const wrap = wrapRef.current;
    if (!active || !svg || !wrap) {
      setAnchor(null);
      return;
    }
    const band = svg.getBoundingClientRect();
    const frame = wrap.getBoundingClientRect();
    const cell = cellAt(active.task, active.attempt);
    const top = band.top - frame.top + cell.y;
    setAnchor({ x: band.left - frame.left + cell.x + size / 2, top, bottom: top + size });
    // cellAt is rebuilt every render; the layout values it reads are what the anchor follows.
  }, [active, width, size, perLine, attempts, lineHeight, wrapRef]);

  const titleOf = (task: WaffleTask) =>
    task.taskIds
      .map((id) => taskTitles[`${task.benchmarkId}/${id}`] ?? id)
      .join(S.hub.listSeparator);
  const describe = (cell: Cell) => {
    const task = tasks[cell.task]!;
    const score = ranked[cell.row]?.scores[cell.task]?.[cell.attempt];
    return score === undefined
      ? t.taskEmpty(titleOf(task), cell.attempt + 1)
      : t.taskScore(titleOf(task), cell.attempt + 1, formatScore(score));
  };

  const pick = (row: number) => (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const line = Math.min(lines - 1, Math.floor(y / (lineHeight + LINE_GAP)));
    const attempt = Math.min(
      attempts - 1,
      Math.floor((y - line * (lineHeight + LINE_GAP)) / pitch),
    );
    const task = line * perLine + Math.min(perLine - 1, Math.floor(x / pitch));
    if (attempt < 0 || task < 0 || task >= tasks.length) return;
    if (active?.row === row && active.task === task && active.attempt === attempt) {
      // A second tap on the same square puts the readout away.
      if (event.type === "pointerdown" && event.pointerType !== "mouse") setActive(null);
      return;
    }
    setActive({ row, task, attempt });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = active ?? { row: 0, task: 0, attempt: 0 };
    const last = { row: ranked.length - 1, task: tasks.length - 1 };
    let next: Cell | null = at;
    switch (event.key) {
      case "ArrowRight":
        next = { ...at, task: Math.min(last.task, at.task + 1) };
        break;
      case "ArrowLeft":
        next = { ...at, task: Math.max(0, at.task - 1) };
        break;
      case "ArrowDown":
        next =
          at.attempt + 1 < attempts
            ? { ...at, attempt: at.attempt + 1 }
            : at.row < last.row
              ? { ...at, row: at.row + 1, attempt: 0 }
              : at;
        break;
      case "ArrowUp":
        next =
          at.attempt > 0
            ? { ...at, attempt: at.attempt - 1 }
            : at.row > 0
              ? { ...at, row: at.row - 1, attempt: attempts - 1 }
              : at;
        break;
      case "PageDown":
        next = { ...at, row: Math.min(last.row, at.row + 1) };
        break;
      case "PageUp":
        next = { ...at, row: Math.max(0, at.row - 1) };
        break;
      case "Home":
        next = { ...at, task: 0 };
        break;
      case "End":
        next = { ...at, task: last.task };
        break;
      case "Escape":
        next = null;
        break;
      default:
        return;
    }
    event.preventDefault();
    setActive(next);
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (active === null && event.currentTarget.matches(":focus-visible")) {
      setActive({ row: 0, task: 0, attempt: 0 });
    }
  };

  if (tasks.length === 0 || ranked.length === 0) return null;

  const swatch = WRAP_SIZE;
  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-600 dark:text-gray-400"
        style={{ paddingLeft: side ? LABEL_WIDTH + LABEL_GAP : 0 }}
      >
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
      </div>

      <div
        ref={wrapRef}
        role="group"
        tabIndex={0}
        aria-label={t.charts.waffle}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className={`relative mt-4 flex flex-col gap-3 rounded-sm ${CHART_FOCUS}`}
      >
        {width > 0 &&
          ranked.map((row, r) => (
            <div key={`${row.entry.key}:${row.index}`} className={side ? "flex gap-4" : ""}>
              <div
                className="text-sm leading-5 font-medium [overflow-wrap:anywhere]"
                style={
                  side
                    ? { width: LABEL_WIDTH, flexShrink: 0, marginTop: (size - 20) / 2 }
                    : undefined
                }
              >
                {labels[r]}
              </div>
              <svg
                ref={(element) => {
                  bands.current[r] = element;
                }}
                width={bandWidth}
                height={bandHeight}
                role="img"
                aria-label={t.waffleRow(labels[r]!, formatScore(row.entry.value))}
                className={`block shrink-0 overflow-visible ${side ? "" : "mt-1.5"}`}
                onPointerMove={pick(r)}
                onPointerDown={pick(r)}
                onPointerLeave={(event) => {
                  if (event.pointerType === "mouse") setActive(null);
                }}
              >
                {tasks.map((_, k) =>
                  Array.from({ length: attempts }, (_, a) => {
                    const score = row.scores[k]?.[a];
                    const { x, y } = cellAt(k, a);
                    return score === undefined ? (
                      <rect
                        key={`${k}:${a}`}
                        x={x + 0.5}
                        y={y + 0.5}
                        width={size - 1}
                        height={size - 1}
                        rx="2"
                        className={EMPTY}
                      />
                    ) : (
                      <rect
                        key={`${k}:${a}`}
                        x={x}
                        y={y}
                        width={size}
                        height={size}
                        rx="2"
                        className={stepOf(score)}
                      />
                    );
                  }),
                )}
                {active?.row === r && (
                  <rect
                    x={cellAt(active.task, active.attempt).x - 1.5}
                    y={cellAt(active.task, active.attempt).y - 1.5}
                    width={size + 3}
                    height={size + 3}
                    rx="3"
                    fill="none"
                    strokeWidth="1.5"
                    className="stroke-gray-900 dark:stroke-gray-100"
                  />
                )}
              </svg>
            </div>
          ))}
        {active && anchor && (
          <Readout
            id={`${active.row}:${active.task}:${active.attempt}`}
            anchor={anchor}
            bound={width}
            flip={false}
          >
            <div className="font-medium text-gray-900 dark:text-gray-100">{labels[active.row]}</div>
            <div>{describe(active)}</div>
          </Readout>
        )}
        <p aria-live="polite" className="sr-only">
          {active && (
            <>
              <span className="block">{labels[active.row]}</span>
              <span className="block">{describe(active)}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
