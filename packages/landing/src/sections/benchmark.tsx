/**
 * Benchmark section: two suites (complex data analysis + coding tasks), same model
 * everywhere, rendered in one identical format — three small multiples (accuracy /
 * Tokens / cost, one measure per axis) plus a five-column table of per-run means
 * (framework / model / accuracy % / Tokens M / cost $). Suite specifics (case count,
 * runs, thinking level, timeout, pricing) sit in a small footnote under each table.
 * Emphasis form: PenguinHarness wears the brand hue, competitors the de-emphasis
 * gray; per-bar identity comes from logo+name labels, every cap is value-labeled,
 * and the exact table relieves the sub-3:1 gray fills.
 */
import { S } from "../lib/strings";
import { HarnessLogo } from "../components/harness-logo";
import {
  CODE_BENCH,
  DATA_BENCH,
  formatAccuracy,
  formatPct,
  formatTokensM,
  formatUsd,
} from "../lib/benchmark-data";
import type { BenchResult } from "../lib/benchmark-data";

/** Bar path: 4px rounded data-end, square at the baseline. */
function barPath(x: number, w: number, yTop: number, yBase: number): string {
  const r = Math.min(4, Math.max(0, yBase - yTop));
  return [
    `M${x},${yBase}`,
    `V${yTop + r}`,
    `Q${x},${yTop} ${x + r},${yTop}`,
    `H${x + w - r}`,
    `Q${x + w},${yTop} ${x + w},${yTop + r}`,
    `V${yBase}`,
    "Z",
  ].join("");
}

const VIEW_W = 320;
const VIEW_H = 210;
const PLOT_TOP = 28;
const BASELINE = 168;
const BAR_W = 24;

function BarPanel({
  title,
  hint,
  rows,
  values,
  format,
}: {
  title: string;
  hint: string;
  rows: BenchResult[];
  values: number[];
  format: (v: number) => string;
}) {
  const slot = VIEW_W / rows.length;
  // Zoomed domain: the baseline is NOT forced to zero — it sits below the smallest
  // value by ~60% of the data range, so differences between bars stay visible. The
  // truncation is disclosed by the baseline value label at the axis start.
  const dataMax = Math.max(...values);
  const dataMin = Math.min(...values);
  const range = dataMax - dataMin || dataMax || 1;
  const lo = Math.max(0, dataMin - range * 0.6);
  const hi = dataMax + range * 0.25;
  return (
    <figure className="px-4 py-5 sm:px-5">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold tracking-tight">{title}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{hint}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="mt-2 w-full"
        role="img"
        aria-label={`${title}: ${rows.map((r, i) => `${r.framework} ${format(values[i] ?? 0)}`).join(", ")}`}
      >
        {rows.map((row, i) => {
          const v = values[i] ?? 0;
          const h = ((v - lo) / (hi - lo)) * (BASELINE - PLOT_TOP);
          const yTop = BASELINE - h;
          const cx = slot * i + slot / 2;
          return (
            <g key={row.framework} className="transition-opacity hover:opacity-80">
              <title>{`${row.framework} · ${format(v)}`}</title>
              <path
                d={barPath(cx - BAR_W / 2, BAR_W, yTop, BASELINE)}
                className={
                  row.emphasized
                    ? "fill-brand-600 dark:fill-brand-400"
                    : "fill-gray-400 dark:fill-gray-600"
                }
              />
              {/* Value on the cap — text tokens, never the series color. */}
              <text
                x={cx}
                y={yTop - 8}
                textAnchor="middle"
                className="fill-gray-900 text-[13px] font-semibold dark:fill-gray-100"
              >
                {format(v)}
              </text>
              {/* Identity label: brand mark + name, centered under the bar. */}
              <foreignObject x={slot * i} y={BASELINE + 8} width={slot} height={30}>
                <div
                  className={`flex items-center justify-center gap-0.5 text-[10px] leading-tight whitespace-nowrap ${
                    row.emphasized
                      ? "font-semibold text-gray-900 dark:text-gray-100"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  <HarnessLogo kind={row.kind} className="h-3 w-3 shrink-0" />
                  <span>{row.framework}</span>
                </div>
              </foreignObject>
            </g>
          );
        })}
        <line
          x1="4"
          x2={VIEW_W - 4}
          y1={BASELINE}
          y2={BASELINE}
          className="stroke-gray-200 dark:stroke-gray-800"
          strokeWidth="1"
        />
        {/* Baseline value: discloses that the axis starts above zero. */}
        <text
          x={5}
          y={BASELINE - 5}
          textAnchor="start"
          className="fill-gray-400 text-[9px] tabular-nums dark:fill-gray-500"
        >
          {format(lo)}
        </text>
      </svg>
    </figure>
  );
}

const TH = "px-3 py-2.5 font-medium whitespace-nowrap";

/**
 * One suite, one format: header row + three panels + the unified five-column table
 * + a small footnote carrying the run settings. Only numbers and names differ
 * between suites (and the decimal precision they were published at).
 */
function SuiteBlock({
  title,
  desc,
  rows,
  accDp,
  tokenDp,
  costDp,
  footnote,
}: {
  title: string;
  desc: string;
  rows: BenchResult[];
  accDp: number;
  tokenDp: number;
  costDp: number;
  footnote: string;
}) {
  const rowCls = (emphasized?: boolean) =>
    `border-b border-gray-100 last:border-0 dark:border-gray-800/60 ${
      emphasized ? "bg-brand-25 dark:bg-brand-950/40" : ""
    }`;
  return (
    <div>
      <div className="mb-5">
        <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{desc}</p>
      </div>
      <div className="grid divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
        <BarPanel
          title={S.benchmark.dimScore}
          hint={`↑ ${S.benchmark.higherBetter}`}
          rows={rows}
          values={rows.map((r) => r.accuracyPct)}
          format={formatPct}
        />
        <BarPanel
          title={S.benchmark.dimTokens}
          hint={`↓ ${S.benchmark.lowerBetter}`}
          rows={rows}
          values={rows.map((r) => r.tokensM)}
          format={(v) => formatTokensM(v, tokenDp)}
        />
        <BarPanel
          title={S.benchmark.dimCost}
          hint={`↓ ${S.benchmark.lowerBetter}`}
          rows={rows}
          values={rows.map((r) => r.costUsd)}
          format={(v) => formatUsd(v, costDp)}
        />
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full min-w-[38rem] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
              <th className={TH}>{S.benchmark.colFramework}</th>
              <th className={TH}>{S.benchmark.colModel}</th>
              <th className={`${TH} text-right`}>{S.benchmark.colAccuracy}</th>
              <th className={`${TH} text-right`}>{S.benchmark.colTokens}</th>
              <th className={`${TH} text-right`}>{S.benchmark.colCost}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.framework} className={rowCls(r.emphasized)}>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-2 font-medium whitespace-nowrap">
                    <HarnessLogo kind={r.kind} className="h-3.5 w-3.5 shrink-0" />
                    {r.framework}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 dark:text-gray-400">
                  {r.model}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatAccuracy(r.accuracyPct, accDp)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.tokensM.toFixed(tokenDp)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.costUsd.toFixed(costDp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">{footnote}</p>
    </div>
  );
}

/** Content-only block (both suites), composed by the Why section. */
export function BenchmarkSuites() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-14">
      <SuiteBlock
        title={S.benchmark.dataTitle}
        desc={S.benchmark.dataDesc}
        rows={DATA_BENCH}
        accDp={1}
        tokenDp={2}
        costDp={3}
        footnote={S.benchmark.dataFootnote}
      />
      <SuiteBlock
        title={S.benchmark.codeTitle}
        desc={S.benchmark.codeDesc}
        rows={CODE_BENCH}
        accDp={2}
        tokenDp={2}
        costDp={3}
        footnote={S.benchmark.codeFootnote}
      />
    </div>
  );
}
