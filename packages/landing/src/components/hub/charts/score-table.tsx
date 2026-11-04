/**
 * The ranking: one row per entry with its rank (the first three in medal tints), model and
 * thinking level, harness, algorithm, score (a bar on a fixed 0–100 scale with the ± std drawn
 * as an error bar), release date and cost. Every cell keeps to one line, cutting long names
 * short with the whole name on hover. A header sorts by its column, a second click reverses it;
 * the rank stays the score's. The page filters the rows and picks the columns (the toolbar's
 * buttons); a score opens the entry's raw data under its row.
 */
import { Fragment, useId, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronDownIcon, SiteGlyph, useSiteLocale } from "@prismshadow/penguin-ui/site";
import type { SiteLocale } from "@prismshadow/penguin-ui/site";
import type { LeaderboardEntry, LeaderboardPart } from "../../../lib/hub/types";
import { formatCompact, formatDay, formatScore, formatUsd } from "../../../lib/hub/text";
import { S } from "../../../lib/strings";
import { AuthorName } from "../hub-detail";
import { ExternalLink } from "../../external-link";
import { byValue } from "./chart-kit";
import { medalOf } from "./entry-colour";
import type { EntryColour } from "./entry-colour";

export type Column = "model" | "harness" | "algorithm" | "released" | "cost";
export const OPTIONAL: readonly Column[] = ["model", "harness", "algorithm", "released", "cost"];
/** The column that names an entry on this board: what its entries differ in. */
export type NameColumn = "algorithm" | "harness" | "model";

/**
 * The columns hidden at first, so the table fits its panel without scrolling: on a phone all but
 * the column that names the entries; below 1024 px the release date and whichever of the model,
 * harness and algorithm do not name them; below 1280 px the release date. The Columns menu shows
 * any of them again.
 */
export function initialHidden(nameColumn: NameColumn): Column[] {
  if (typeof window === "undefined") return [];
  const below = (px: number) => window.matchMedia(`(max-width: ${px - 1}px)`).matches;
  if (below(640)) return OPTIONAL.filter((column) => column !== nameColumn);
  if (below(1024)) {
    return [
      "released",
      ...(["model", "harness", "algorithm"] as const).filter((c) => c !== nameColumn),
    ];
  }
  if (below(1280)) return ["released"];
  return [];
}

type SortKey = "score" | "model" | "harness" | "algorithm" | "released" | "cost";
/** A first click sorts best, newest or cheapest first; names go A to Z. */
const FIRST_DESC: Record<SortKey, boolean> = {
  score: true,
  released: true,
  cost: false,
  model: false,
  harness: false,
  algorithm: false,
};

/** The widest a name column grows before its names are cut short. */
const WIDTH: Record<NameColumn, string> = {
  model: "max-w-28 sm:max-w-44 lg:max-w-60",
  harness: "max-w-24 min-[380px]:max-w-28 sm:max-w-36 lg:max-w-48",
  algorithm: "max-w-24 min-[380px]:max-w-28 sm:max-w-40 lg:max-w-52",
};

const TH = "py-2 pr-3 text-left font-medium whitespace-nowrap last:pr-0";
const TD = "py-2.5 pr-3 whitespace-nowrap last:pr-0";

const distinct = (values: readonly string[]): string[] => [...new Set(values)];

/** One run's time: minutes under an hour, else hours to one decimal. */
export function formatDuration(ms: number): string {
  const t = S.hub.leaderboards;
  const minutes = ms / 60_000;
  return minutes < 60
    ? t.minutesShort(String(Math.max(1, Math.round(minutes))))
    : t.hoursShort((minutes / 60).toFixed(1));
}

/** A name cut to one line, whole on hover. */
function Cut({
  text,
  className = "",
  children,
}: {
  text: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span title={text} className={`block min-w-0 truncate ${className}`}>
      {children ?? text}
    </span>
  );
}

export function Dot({ colour }: { colour: EntryColour }) {
  return <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${colour.dot}`} />;
}

export function ScoreTable({
  entries,
  all,
  hidden,
  nameColumn,
  algorithmOf,
  colourOf,
  benchmarkTitle,
  benchmarkListed,
  filtered,
  onClearFilters,
}: {
  /** The rows to show, after the page's filters. */
  entries: readonly LeaderboardEntry[];
  /** Every entry of the board: the rank is the score's place among them. */
  all: readonly LeaderboardEntry[];
  hidden: ReadonlySet<Column>;
  nameColumn: NameColumn;
  /** The entry's algorithm as a reader names it (the plugin's title, or the baseline). */
  algorithmOf: (entry: LeaderboardEntry) => string;
  colourOf: (entry: LeaderboardEntry) => EntryColour;
  benchmarkTitle: (id: string) => string;
  benchmarkListed: (id: string) => boolean;
  filtered: boolean;
  onClearFilters: () => void;
}) {
  const t = S.hub.leaderboards;
  const { locale } = useSiteLocale();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "score", desc: true });
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const ids = useId();

  const rankOf = (entry: LeaderboardEntry) =>
    1 + all.filter((other) => other.value > entry.value).length;
  const has = (column: Column) => !hidden.has(column);
  const span = 2 + OPTIONAL.filter(has).length;
  const modelText = (entry: LeaderboardEntry) =>
    entry.thinking ? t.modelThinking(entry.model, entry.thinking) : entry.model;
  const harnessText = (entry: LeaderboardEntry) =>
    `${entry.harness} ${entry.harnessVersion}`.trim();
  /** The dot goes before the name column; when that column is hidden, before the model. */
  const dotAt: NameColumn | null = has(nameColumn) ? nameColumn : has("model") ? "model" : null;

  const keyOf: Record<SortKey, (entry: LeaderboardEntry) => string | number> = {
    score: (entry) => entry.value,
    model: modelText,
    harness: harnessText,
    algorithm: algorithmOf,
    released: (entry) => entry.submitted,
    cost: (entry) => entry.cost,
  };
  const rows = byValue(entries);
  if (sort.key !== "score" || !sort.desc) {
    const read = keyOf[sort.key];
    rows.sort((a, b) => {
      const x = read(a);
      const y = read(b);
      const order =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), locale);
      return sort.desc ? -order : order;
    });
  }

  const sortBy = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: FIRST_DESC[key] },
    );
  const toggleRow = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const header = (key: SortKey, label: string, align: "left" | "right" = "left") => {
    const on = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={on ? (sort.desc ? "descending" : "ascending") : undefined}
        className={`${TH} ${align === "right" ? "text-right" : ""}`}
      >
        <button
          type="button"
          onClick={() => sortBy(key)}
          title={t.sortBy(label)}
          className={`inline-flex items-center gap-1 rounded transition-colors hover:text-gray-900 dark:hover:text-gray-100 ${
            on ? "text-gray-900 dark:text-gray-100" : ""
          }`}
        >
          {label}
          <SiteGlyph
            name={on ? (sort.desc ? "arrowDown" : "arrowUp") : "arrowUpDown"}
            className={`h-3 w-3 shrink-0 ${on ? "" : "opacity-50"}`}
          />
        </button>
      </th>
    );
  };

  return (
    // Positioned, so the screen-reader-only labels inside stay within its clip.
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <th scope="col" className={`${TH} w-px`}>
              {t.rank}
            </th>
            {has("model") && header("model", t.model)}
            {has("harness") && header("harness", t.columnNames.harness)}
            {has("algorithm") && header("algorithm", t.columnNames.algorithm)}
            {header("score", t.score)}
            {has("released") && header("released", t.columnNames.released)}
            {has("cost") && header("cost", t.columnNames.cost, "right")}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0 [&>tr:nth-last-child(2)]:border-b-0">
          {rows.length === 0 && (
            <tr>
              <td colSpan={span} className="py-10 text-center text-gray-600 dark:text-gray-400">
                <p>{t.noMatch}</p>
                {filtered && (
                  <button
                    type="button"
                    onClick={onClearFilters}
                    className="mt-2 text-brand-700 hover:underline dark:text-brand-300"
                  >
                    {S.hub.clearFilters}
                  </button>
                )}
              </td>
            </tr>
          )}
          {rows.map((entry, index) => {
            const isOpen = open.has(entry.key);
            const rowId = `${ids}-raw-${index}`;
            const rank = rankOf(entry);
            const medal = medalOf(rank);
            const named = (column: NameColumn, text: string, extra?: ReactNode) => (
              <span className="flex min-w-0 items-center gap-2">
                {dotAt === column && <Dot colour={colourOf(entry)} />}
                <Cut
                  text={text}
                  className={`${WIDTH[column]} ${
                    column === nameColumn ? "font-medium text-gray-900 dark:text-gray-100" : ""
                  }`}
                >
                  {extra ?? text}
                </Cut>
              </span>
            );
            return (
              <Fragment key={entry.key}>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <td className={TD}>
                    <span
                      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums ${
                        medal ?? "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {rank}
                    </span>
                  </td>
                  {has("model") && <td className={TD}>{named("model", modelText(entry))}</td>}
                  {has("harness") && (
                    <td className={`${TD} text-gray-700 dark:text-gray-300`}>
                      {named(
                        "harness",
                        harnessText(entry),
                        <>
                          {entry.harness}
                          {entry.harnessVersion && (
                            <span className="ml-1.5 text-xs text-gray-500 tabular-nums dark:text-gray-400">
                              {entry.harnessVersion}
                            </span>
                          )}
                        </>,
                      )}
                    </td>
                  )}
                  {has("algorithm") && (
                    <td className={TD}>{named("algorithm", algorithmOf(entry))}</td>
                  )}
                  <td className={`${TD} py-1.5`}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={rowId}
                      onClick={() => toggleRow(entry.key)}
                      className="-ml-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      <span className="w-9 font-semibold tabular-nums">
                        {formatScore(entry.value)}
                      </span>
                      <span className="w-11 text-xs text-gray-500 tabular-nums dark:text-gray-400">
                        {entry.std !== null && `± ${formatScore(entry.std)}`}
                      </span>
                      <ScoreBar value={entry.value} std={entry.std} />
                      <span className="sr-only">{t.rawData}</span>
                      <ChevronDownIcon
                        aria-hidden
                        className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                  </td>
                  {has("released") && (
                    <td className={`${TD} text-gray-700 tabular-nums dark:text-gray-300`}>
                      {formatDay(entry.submitted, locale)}
                    </td>
                  )}
                  {has("cost") && (
                    <td className={`${TD} text-right tabular-nums`}>{formatUsd(entry.cost)}</td>
                  )}
                </tr>
                <tr id={rowId} hidden={!isOpen}>
                  <td
                    colSpan={span}
                    className="border-b border-gray-100 bg-gray-50 px-3 py-4 sm:px-4 dark:border-gray-800 dark:bg-gray-950"
                  >
                    {isOpen && (
                      // Fills the row without widening the table: the experiments scroll inside.
                      <div className="w-0 min-w-full">
                        <RawData
                          entry={entry}
                          locale={locale}
                          benchmarkTitle={benchmarkTitle}
                          benchmarkListed={benchmarkListed}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A 0–100 bar for the score, with ± std as a whisker across its end. */
function ScoreBar({ value, std }: { value: number; std: number | null }) {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const end = clamp(value);
  const lo = std === null ? end : clamp(value - std);
  const hi = std === null ? end : clamp(value + std);
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      className="hidden h-3 w-24 shrink-0 sm:block xl:w-32"
    >
      <rect x="0" y="3" width="100" height="6" className="fill-gray-100 dark:fill-gray-800" />
      <rect x="0" y="3" width={end} height="6" className="fill-brand-500" />
      {std !== null && hi > lo && (
        <g
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          className="stroke-gray-900 dark:stroke-gray-100"
        >
          <line x1={lo} x2={hi} y1="6" y2="6" vectorEffect="non-scaling-stroke" />
          <line x1={lo} x2={lo} y1="1" y2="11" vectorEffect="non-scaling-stroke" />
          <line x1={hi} x2={hi} y1="1" y2="11" vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </svg>
  );
}

const settingText = (value: unknown): string =>
  value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);

function Settings({ setting }: { setting?: Record<string, unknown> }) {
  const entries = Object.entries(setting ?? {});
  if (entries.length === 0) {
    return <p className="text-gray-600 dark:text-gray-400">{S.hub.leaderboards.raw.notRecorded}</p>;
  }
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
      {entries.map(([key, value]) => (
        <Fragment key={key}>
          <dt className="text-gray-500 dark:text-gray-400">{key}</dt>
          <dd className="[overflow-wrap:anywhere]">{settingText(value)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** What an entry was computed from: each experiment's summary, and the setup they ran with. */
function RawData({
  entry,
  locale,
  benchmarkTitle,
  benchmarkListed,
}: {
  entry: LeaderboardEntry;
  locale: SiteLocale;
  benchmarkTitle: (id: string) => string;
  benchmarkListed: (id: string) => boolean;
}) {
  const t = S.hub.leaderboards.raw;
  const settings = distinct(entry.parts.map((part) => JSON.stringify(part.harnessSetting ?? {})));
  const shared = settings.length === 1;
  const facts = [
    { label: t.harness, value: `${entry.harness} ${entry.harnessVersion}`.trim() },
    ...(entry.provider ? [{ label: t.provider, value: entry.provider }] : []),
    ...(entry.thinking ? [{ label: t.thinking, value: entry.thinking }] : []),
    { label: t.phase, value: entry.parts[0]?.phase ?? "" },
    {
      label: t.std,
      value:
        entry.stdFrom === "attempts"
          ? t.stdAttempts(entry.attempts)
          : entry.stdFrom === "experiments"
            ? t.stdExperiments
            : t.notRecorded,
    },
  ];
  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {facts.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {entry.author && (
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">{S.hub.meta.author}</dt>
            <dd>
              <AuthorName author={entry.author} />
            </dd>
          </div>
        )}
      </dl>

      <div>
        <h3 className="text-xs text-gray-500 dark:text-gray-400">{t.experiments}</h3>
        <div className="relative mt-1.5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th scope="col" className={TH}>
                  {t.benchmark}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t.value}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t.attempts}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {S.hub.leaderboards.cost}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {S.hub.leaderboards.duration}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t.tokens}
                </th>
                <th scope="col" className={TH}>
                  {t.finished}
                </th>
              </tr>
            </thead>
            <tbody>
              {entry.parts.map((part) => (
                <PartRow
                  key={part.experimentId}
                  part={part}
                  locale={locale}
                  benchmarkTitle={benchmarkTitle}
                  benchmarkListed={benchmarkListed}
                  setting={shared ? undefined : part.harnessSetting}
                  showSetting={!shared}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {shared && (
        <div>
          <h3 className="text-xs text-gray-500 dark:text-gray-400">{t.harnessSetting}</h3>
          <div className="mt-1.5">
            <Settings setting={entry.parts[0]?.harnessSetting} />
          </div>
        </div>
      )}

      {entry.references.length > 0 && (
        <div>
          <h3 className="text-xs text-gray-500 dark:text-gray-400">{S.hub.references}</h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {entry.references.map((href) => (
              <li key={href} className="[overflow-wrap:anywhere]">
                <ExternalLink
                  href={href}
                  className="text-brand-700 hover:underline dark:text-brand-300"
                >
                  {href}
                </ExternalLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A benchmark's name, linking to its page when that page exists (drafts have none). */
export function BenchmarkName({
  id,
  title,
  listed,
  className = "",
}: {
  id: string;
  title: string;
  listed: boolean;
  className?: string;
}) {
  return listed ? (
    <Link
      to={`/benchmarks/${id}`}
      title={title}
      className={`block min-w-0 truncate text-brand-700 hover:underline dark:text-brand-300 ${className}`}
    >
      {title}
    </Link>
  ) : (
    <span title={title} className={`block min-w-0 truncate ${className}`}>
      {title}
    </span>
  );
}

function PartRow({
  part,
  locale,
  benchmarkTitle,
  benchmarkListed,
  setting,
  showSetting,
}: {
  part: LeaderboardPart;
  locale: SiteLocale;
  benchmarkTitle: (id: string) => string;
  benchmarkListed: (id: string) => boolean;
  setting?: Record<string, unknown>;
  showSetting: boolean;
}) {
  const t = S.hub.leaderboards.raw;
  return (
    <tr className="border-b border-gray-100 last:border-0 dark:border-gray-800">
      <td className={TD}>
        {part.benchmarks.map((id) => (
          <BenchmarkName
            key={id}
            id={id}
            title={benchmarkTitle(id)}
            listed={benchmarkListed(id)}
            className="max-w-72"
          />
        ))}
        <ExternalLink
          href={part.url}
          title={part.experimentId}
          className="block max-w-72 truncate text-xs text-gray-500 hover:underline dark:text-gray-400"
        >
          {part.experimentId}
        </ExternalLink>
        {showSetting && (
          <div className="mt-2 text-xs whitespace-normal">
            <p className="text-gray-500 dark:text-gray-400">{t.harnessSetting}</p>
            <Settings setting={setting} />
          </div>
        )}
      </td>
      <td className={`${TD} text-right tabular-nums`}>
        {formatScore(part.value)}
        {part.scoreStd !== null && (
          <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
            ± {formatScore(part.scoreStd)}
          </span>
        )}
      </td>
      <td className={`${TD} text-right tabular-nums`}>{part.attempts}</td>
      <td className={`${TD} text-right tabular-nums`}>{formatUsd(part.cost)}</td>
      <td className={`${TD} text-right tabular-nums`}>{formatDuration(part.durationMs)}</td>
      <td className={`${TD} text-right tabular-nums`}>
        {[part.inputTokens, part.cacheTokens, part.outputTokens].map(formatCompact).join(" / ")}
      </td>
      <td className={TD}>{formatDay(part.finished, locale)}</td>
    </tr>
  );
}
