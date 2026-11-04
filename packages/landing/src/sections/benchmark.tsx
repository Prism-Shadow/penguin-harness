/**
 * Benchmark section: two suites (complex data analysis + coding tasks), each harness on
 * the model it is normally paired with, rendered in one identical format — three small
 * multiples (accuracy / Tokens / cost, one measure per axis) plus a five-column table of
 * suite totals (framework / model / accuracy % / Tokens M / cost $). Suite specifics
 * (case count, runs, thinking level, timeout, pricing) sit in a footnote under each table.
 * Emphasis form: PenguinHarness wears the brand hue, competitors the de-emphasis gray. Bars
 * start at zero, every cap carries its value, and each bar is named by its logo; the table
 * right under the charts names every row in full and relieves the sub-3:1 gray fills.
 *
 * The plots are laid out at the width they are shown at (a viewBox as wide as the figure), so a
 * label is set at the page's own sizes rather than shrunk with the drawing.
 */
import { S } from "../lib/strings";
import { useWidth } from "../lib/use-width";
import { Section } from "../components/section";
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

/** The width a plot is laid out at before its figure has been measured. */
const FALLBACK_W = 260;
const VIEW_H = 196;
const PLOT_TOP = 26;
const BASELINE = 164;
const BAR_W = 24;
/** The logo naming a bar, centred under it. */
const LOGO = 14;
/**
 * Shortest a bar may render. At true scale the cost panels put PenguinHarness at ~2px
 * against a 140px plot (the spread is ~70x), which reads as an empty slot rather than a
 * winning series. The floor keeps it visible while still plainly the smallest bar, and
 * every cap carries its exact value.
 */
const MIN_BAR_H = 12;

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
  const { ref, width } = useWidth<HTMLDivElement>(FALLBACK_W);
  const slot = width / rows.length;
  // Bars start at zero, so their lengths compare as the values do.
  const hi = Math.max(...values) * 1.12 || 1;
  return (
    <figure className="px-4 py-5 sm:px-5">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold tracking-tight">{title}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{hint}</span>
      </figcaption>
      <div ref={ref} className="mt-2">
        <svg
          viewBox={`0 0 ${width} ${VIEW_H}`}
          width={width}
          height={VIEW_H}
          className="block w-full"
          role="img"
          aria-label={`${title}: ${rows.map((r, i) => `${r.framework} ${format(values[i] ?? 0)}`).join(", ")}`}
        >
          {rows.map((row, i) => {
            const v = values[i] ?? 0;
            const h = Math.max(MIN_BAR_H, (v / hi) * (BASELINE - PLOT_TOP));
            const yTop = BASELINE - h;
            const cx = slot * i + slot / 2;
            return (
              <g key={row.framework}>
                <title>{`${row.framework}: ${format(v)}`}</title>
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
                  className="fill-gray-900 text-xs font-semibold tabular-nums dark:fill-gray-100"
                >
                  {format(v)}
                </text>
                {/* The bar's name is its logo; the table under the charts spells it out. */}
                <foreignObject x={cx - LOGO / 2} y={BASELINE + 10} width={LOGO} height={LOGO}>
                  <div
                    className={
                      row.emphasized
                        ? "text-gray-900 dark:text-gray-100"
                        : "text-gray-500 dark:text-gray-400"
                    }
                  >
                    <HarnessLogo kind={row.kind} className="block h-3.5 w-3.5" />
                  </div>
                </foreignObject>
              </g>
            );
          })}
          <line
            x1="0"
            x2={width}
            y1={BASELINE}
            y2={BASELINE}
            className="stroke-gray-200 dark:stroke-gray-800"
            strokeWidth="1"
          />
        </svg>
      </div>
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
      <div className="mt-5 grid gap-2 sm:hidden">
        {rows.map((r) => (
          <article
            key={r.framework}
            className={`rounded-xl border p-4 ${
              r.emphasized
                ? "border-brand-200 bg-brand-25 dark:border-brand-800 dark:bg-brand-950/40"
                : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <HarnessLogo kind={r.kind} className="h-4 w-4 shrink-0" />
              <strong className="truncate text-sm">{r.framework}</strong>
              <span className="ml-auto truncate text-xs text-gray-500 dark:text-gray-400">
                {r.model}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">
                  {S.benchmark.colAccuracy}
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                  {formatAccuracy(r.accuracyPct, accDp)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">
                  {S.benchmark.colTokens}
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                  {r.tokensM.toFixed(tokenDp)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">{S.benchmark.colCost}</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                  {r.costUsd.toFixed(costDp)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <div className="mt-5 hidden overflow-x-auto rounded-xl border border-gray-200 bg-white sm:block dark:border-gray-800 dark:bg-gray-900">
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

export function Benchmark() {
  return (
    <Section id="benchmark" title={S.benchmark.title} subtitle={S.benchmark.subtitle}>
      <div className="mx-auto flex max-w-4xl flex-col gap-14">
        <SuiteBlock
          title={S.benchmark.dataTitle}
          desc={S.benchmark.dataDesc}
          rows={DATA_BENCH}
          accDp={2}
          tokenDp={2}
          costDp={2}
          footnote={S.benchmark.dataFootnote}
        />
        <SuiteBlock
          title={S.benchmark.codeTitle}
          desc={S.benchmark.codeDesc}
          rows={CODE_BENCH}
          accDp={2}
          tokenDp={2}
          costDp={2}
          footnote={S.benchmark.codeFootnote}
        />
      </div>
    </Section>
  );
}
