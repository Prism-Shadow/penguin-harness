/**
 * How a leaderboard's numbers are computed, shown with the numbers themselves. When every entry
 * combines the same benchmarks the same way (one op, one phase, one metric), a matrix: a row per
 * benchmark, a column per entry, each cell that experiment's metric; then the rows the columns
 * come to (the op's result, the ±, one run's cost and time). Otherwise each entry's expression is
 * spelled out, argument by argument. A sentence or two says what the cells are and how the ± is
 * taken.
 */
import type { ReactNode } from "react";
import type { LeaderboardEntry, LeaderboardPart } from "../../../lib/hub/types";
import { formatUsd } from "../../../lib/hub/text";
import { S } from "../../../lib/strings";
import { ExternalLink } from "../../external-link";
import { InlineText } from "../inline-text";
import { byValue } from "./chart-kit";
import type { EntryColour } from "./entry-colour";
import { BenchmarkName, Dot, formatDuration } from "./score-table";

const distinct = <T,>(values: readonly T[]): T[] => [...new Set(values)];
/** A metric value as the summary gives it, to two decimals. */
const exact = (value: number) => value.toFixed(2);
const partKey = (part: LeaderboardPart) => part.benchmarks.join("+");
const shapeOf = (entry: LeaderboardEntry) =>
  JSON.stringify([
    entry.op,
    entry.parts.map((part) => [partKey(part), part.phase, part.metric]).sort(),
  ]);

const TH =
  "py-2 pr-4 text-left text-xs font-medium whitespace-nowrap text-gray-500 last:pr-0 dark:text-gray-400";
const TD = "py-2 pr-4 whitespace-nowrap tabular-nums last:pr-0";

export function MethodDetail({
  entries,
  labelOf,
  colourOf,
  benchmarkTitle,
  benchmarkListed,
}: {
  entries: readonly LeaderboardEntry[];
  labelOf: (entry: LeaderboardEntry) => string;
  colourOf: (entry: LeaderboardEntry) => EntryColour;
  benchmarkTitle: (id: string) => string;
  benchmarkListed: (id: string) => boolean;
}) {
  const t = S.hub.leaderboards.method;
  const ranked = byValue(entries);
  if (ranked.length === 0) return null;
  const first = ranked[0]!;
  const uniform = ranked.every((entry) => shapeOf(entry) === shapeOf(first));
  const stdFrom = distinct(ranked.map((entry) => entry.stdFrom));
  const attempts = distinct(
    ranked.filter((entry) => entry.stdFrom === "attempts").map((entry) => entry.attempts),
  );
  const stdSentence = stdFrom.includes("experiments")
    ? stdFrom.includes("attempts")
      ? t.stdExperimentsSome
      : t.stdExperiments
    : stdFrom.includes("attempts")
      ? t.stdAttempts(attempts.length === 1 ? attempts[0]! : null)
      : undefined;

  const head = (entry: LeaderboardEntry) => (
    <span className="flex items-center justify-end gap-1.5">
      <Dot colour={colourOf(entry)} />
      <span title={labelOf(entry)} className="max-w-32 truncate text-gray-900 dark:text-gray-100">
        {labelOf(entry)}
      </span>
    </span>
  );
  const benchmarkCell = (ids: readonly string[]) =>
    ids.map((id) => (
      <span key={id} className="block min-w-0">
        <BenchmarkName
          id={id}
          title={benchmarkTitle(id)}
          listed={benchmarkListed(id)}
          className="max-w-36 sm:max-w-64"
        />
        <span
          title={id}
          className="block max-w-36 truncate text-xs text-gray-500 sm:max-w-64 dark:text-gray-400"
        >
          {id}
        </span>
      </span>
    ));

  let body: ReactNode;
  let lead: string;
  if (uniform) {
    const rows = [...first.parts].sort((a, b) => partKey(a).localeCompare(partKey(b)));
    const phase = first.parts[0]?.phase ?? "";
    const metric = first.parts[0]?.metric ?? "";
    lead = t.matrixLead(metric, phase);
    const valueAt = (entry: LeaderboardEntry, key: string) =>
      entry.parts.find((part) => partKey(part) === key)?.value;
    const footer = (
      label: ReactNode,
      cell: (entry: LeaderboardEntry) => ReactNode,
      strong = false,
    ) => (
      <tr className="border-t border-gray-200 dark:border-gray-700">
        <th scope="row" className={`${TD} text-left font-medium text-gray-700 dark:text-gray-300`}>
          {label}
        </th>
        {ranked.map((entry) => (
          <td
            key={entry.key}
            className={`${TD} text-right ${strong ? "font-semibold text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`}
          >
            {cell(entry)}
          </td>
        ))}
      </tr>
    );
    body = (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-800">
            <th scope="col" className={TH}>
              {t.benchmark}
            </th>
            {ranked.map((entry) => (
              <th key={entry.key} scope="col" className={`${TH} text-right`}>
                {head(entry)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((part) => (
            <tr
              key={partKey(part)}
              className="border-b border-gray-100 last:border-0 dark:border-gray-800"
            >
              <th scope="row" className={`${TD} text-left font-normal`}>
                {benchmarkCell(part.benchmarks)}
              </th>
              {ranked.map((entry) => {
                const value = valueAt(entry, partKey(part));
                return (
                  <td key={entry.key} className={`${TD} text-right align-top`}>
                    {value === undefined ? "" : exact(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {footer(t.opRow(first.op), (entry) => exact(entry.value), true)}
          {footer(t.stdRow, (entry) => (entry.std === null ? "" : `± ${exact(entry.std)}`))}
          {footer(t.costRow, (entry) => formatUsd(entry.cost))}
          {footer(t.timeRow, (entry) => formatDuration(entry.durationMs))}
        </tfoot>
      </table>
    );
  } else {
    lead = t.listLead;
    body = (
      <div className="flex flex-col gap-5">
        {ranked.map((entry) => (
          <div key={entry.key}>
            <p className="flex items-center gap-2 text-sm font-medium">
              <Dot colour={colourOf(entry)} />
              {labelOf(entry)}
              <span className="font-normal text-gray-500 dark:text-gray-400">
                {t.opName(entry.op)} = {exact(entry.value)}
                {entry.std !== null && ` ± ${exact(entry.std)}`}
              </span>
            </p>
            <table className="mt-1.5 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th scope="col" className={TH}>
                    {t.benchmark}
                  </th>
                  <th scope="col" className={TH}>
                    {t.experiment}
                  </th>
                  <th scope="col" className={TH}>
                    {t.phase}
                  </th>
                  <th scope="col" className={TH}>
                    {t.metric}
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {t.value}
                  </th>
                </tr>
              </thead>
              <tbody>
                {entry.parts.map((part) => (
                  <tr
                    key={part.experimentId}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                  >
                    <td className={TD}>{benchmarkCell(part.benchmarks)}</td>
                    <td className={TD}>
                      <ExternalLink
                        href={part.url}
                        title={part.experimentId}
                        className="block max-w-64 truncate text-brand-700 hover:underline dark:text-brand-300"
                      >
                        {part.experimentId}
                      </ExternalLink>
                    </td>
                    <td className={TD}>
                      <InlineText>{`\`${part.phase}\``}</InlineText>
                    </td>
                    <td className={TD}>
                      <InlineText>{`\`${part.metric}\``}</InlineText>
                    </td>
                    <td className={`${TD} text-right`}>{exact(part.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-1.5 text-sm leading-7 text-gray-700 dark:text-gray-300">
        <p>
          <InlineText>{lead}</InlineText>
        </p>
        {stdSentence && (
          <p>
            <InlineText>{stdSentence}</InlineText>
          </p>
        )}
      </div>
      <div className="mt-4 overflow-x-auto">{body}</div>
    </div>
  );
}
