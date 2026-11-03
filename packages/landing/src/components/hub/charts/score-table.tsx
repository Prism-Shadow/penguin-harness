/**
 * The ranking: entries best first, each with its model and thinking level, harness, algorithm,
 * score (a bar on a fixed 0–100 scale with the ± std drawn as an error bar), release date and
 * cost. Rows filter by model, harness, algorithm and thinking level, each offered only when the
 * entries differ on it; the optional columns can be hidden; a score opens the entry's raw data.
 */
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { ChevronDownIcon, useSiteLocale } from "@prismshadow/penguin-ui/site";
import type { SiteLocale } from "@prismshadow/penguin-ui/site";
import type { LeaderboardEntry, LeaderboardPart } from "../../../lib/hub/types";
import { formatCompact, formatDay, formatScore, formatUsd } from "../../../lib/hub/text";
import { S } from "../../../lib/strings";
import { AuthorName } from "../hub-detail";
import { ExternalLink } from "../../external-link";
import { byValue } from "./chart-kit";

type Column = "harness" | "algorithm" | "released" | "cost";
const OPTIONAL: readonly Column[] = ["harness", "algorithm", "released", "cost"];
/**
 * Hidden at first where every column at once would not fit the panel: on a phone all but the
 * algorithm, below 1200 px (the side column narrows the panel from 1024 px) the harness and the
 * release date.
 */
const initialHidden = (): Column[] => {
  if (typeof window === "undefined") return [];
  if (window.matchMedia("(max-width: 639px)").matches) return ["harness", "released", "cost"];
  if (window.matchMedia("(max-width: 1199px)").matches) return ["harness", "released"];
  return [];
};

type FilterKey = "model" | "harness" | "algorithm" | "thinking";
const FILTERS: readonly FilterKey[] = ["algorithm", "model", "harness", "thinking"];

const TH = "py-2 pr-2 text-left font-medium whitespace-nowrap last:pr-0 sm:pr-3";
const TD = "py-2.5 pr-2 align-top last:pr-0 sm:pr-3";
const CHIP_ON = "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200";
const CHIP_OFF = "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800";

const distinct = (values: readonly string[]): string[] => [...new Set(values)];

/** One run's time: minutes under an hour, else hours to one decimal. */
export function formatDuration(ms: number): string {
  const t = S.hub.leaderboards;
  const minutes = ms / 60_000;
  return minutes < 60
    ? t.minutesShort(String(Math.max(1, Math.round(minutes))))
    : t.hoursShort((minutes / 60).toFixed(1));
}

export function ScoreTable({
  entries,
  methodOf,
  benchmarkTitle,
}: {
  entries: readonly LeaderboardEntry[];
  /** The entry's algorithm as a reader names it (the plugin's title, or the baseline). */
  methodOf: (entry: LeaderboardEntry) => string;
  benchmarkTitle: (id: string) => string;
}) {
  const t = S.hub.leaderboards;
  const { locale } = useSiteLocale();
  const ranked = byValue(entries);
  const [chosen, setChosen] = useState<Partial<Record<FilterKey, readonly string[]>>>({});
  const [hidden, setHidden] = useState<ReadonlySet<Column>>(() => new Set(initialHidden()));
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const ids = useId();

  const valueOf: Record<FilterKey, (entry: LeaderboardEntry) => string> = {
    model: (entry) => entry.model,
    harness: (entry) => entry.harness,
    algorithm: methodOf,
    thinking: (entry) => entry.thinking,
  };
  const filters = FILTERS.map((key) => ({
    key,
    values: distinct(ranked.map(valueOf[key]).filter((value) => value !== "")),
  })).filter((filter) => filter.values.length > 1);
  const shown = ranked.filter((entry) =>
    filters.every(({ key }) => {
      const values = chosen[key] ?? [];
      return values.length === 0 || values.includes(valueOf[key](entry));
    }),
  );
  const filtered = filters.some(({ key }) => (chosen[key] ?? []).length > 0);
  const rankOf = (entry: LeaderboardEntry) =>
    1 + ranked.filter((other) => other.value > entry.value).length;
  const has = (column: Column) => !hidden.has(column);
  const span = 3 + OPTIONAL.filter(has).length;

  const toggleChoice = (key: FilterKey, value: string) =>
    setChosen((current) => {
      const values = current[key] ?? [];
      return {
        ...current,
        [key]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value],
      };
    });
  const toggleColumn = (column: Column) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  const toggleRow = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-wrap gap-x-6 gap-y-3">
          {filters.map(({ key, values }) => (
            <div key={key} role="group" aria-label={t.filterLabel(t.filters[key])}>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t.filters[key]}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {values.map((value) => {
                  const on = (chosen[key] ?? []).includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleChoice(key, value)}
                      className={`rounded-md px-2 py-0.5 text-sm whitespace-nowrap transition-colors ${on ? CHIP_ON : CHIP_OFF}`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <ColumnsMenu hidden={hidden} onToggle={toggleColumn} />
      </div>

      {/* Positioned, so the screen-reader-only labels inside stay within its clip. */}
      <div className="relative mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
              <th scope="col" className={`${TH} w-px`}>
                {t.rank}
              </th>
              <th scope="col" className={TH}>
                {t.model}
              </th>
              {has("harness") && (
                <th scope="col" className={TH}>
                  {t.columnNames.harness}
                </th>
              )}
              {has("algorithm") && (
                <th scope="col" className={TH}>
                  {t.columnNames.algorithm}
                </th>
              )}
              <th scope="col" className={TH}>
                {t.score}
              </th>
              {has("released") && (
                <th scope="col" className={TH}>
                  {t.columnNames.released}
                </th>
              )}
              {has("cost") && (
                <th scope="col" className={`${TH} text-right`}>
                  {t.columnNames.cost}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="[&>tr:nth-last-child(2)]:border-b-0 [&>tr:last-child>td]:border-b-0">
            {shown.length === 0 && (
              <tr>
                <td colSpan={span} className="py-10 text-center text-gray-600 dark:text-gray-400">
                  <p>{t.noMatch}</p>
                  {filtered && (
                    <button
                      type="button"
                      onClick={() => setChosen({})}
                      className="mt-2 text-brand-700 hover:underline dark:text-brand-300"
                    >
                      {S.hub.clearFilters}
                    </button>
                  )}
                </td>
              </tr>
            )}
            {shown.map((entry, index) => {
              const isOpen = open.has(entry.key);
              const rowId = `${ids}-raw-${index}`;
              return (
                <Fragment key={entry.key}>
                  <tr
                    className={`border-gray-100 dark:border-gray-800 ${isOpen ? "" : "border-b"}`}
                  >
                    <td className={`${TD} text-gray-500 tabular-nums dark:text-gray-400`}>
                      {rankOf(entry)}
                    </td>
                    <td className={`${TD} min-w-20 sm:min-w-36`}>
                      {entry.thinking ? t.modelThinking(entry.model, entry.thinking) : entry.model}
                    </td>
                    {has("harness") && (
                      <td className={`${TD} text-gray-700 dark:text-gray-300`}>
                        <span className="block">{entry.harness}</span>
                        {entry.harnessVersion && (
                          <span className="block text-xs text-gray-500 tabular-nums dark:text-gray-400">
                            {entry.harnessVersion}
                          </span>
                        )}
                      </td>
                    )}
                    {has("algorithm") && (
                      <td className={`${TD} min-w-16 font-medium sm:min-w-24`}>
                        {methodOf(entry)}
                      </td>
                    )}
                    <td className={`${TD} py-1.5`}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={rowId}
                        onClick={() => toggleRow(entry.key)}
                        className="-ml-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        <span className="flex w-11 flex-col">
                          <span className="font-medium tabular-nums">
                            {formatScore(entry.value)}
                          </span>
                          {entry.std !== null && (
                            <span className="text-xs whitespace-nowrap text-gray-500 tabular-nums dark:text-gray-400">
                              ± {formatScore(entry.std)}
                            </span>
                          )}
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
                      <td className={`${TD} whitespace-nowrap text-gray-700 dark:text-gray-300`}>
                        {formatDay(entry.submitted, locale)}
                      </td>
                    )}
                    {has("cost") && (
                      <td className={`${TD} text-right whitespace-nowrap tabular-nums`}>
                        {formatUsd(entry.cost)}
                      </td>
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
                          <RawData entry={entry} locale={locale} benchmarkTitle={benchmarkTitle} />
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
      className="hidden h-3 w-20 shrink-0 sm:block xl:w-28"
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

/** The optional columns, as checkboxes in a small panel the "Columns" button opens. */
function ColumnsMenu({
  hidden,
  onToggle,
}: {
  hidden: ReadonlySet<Column>;
  onToggle: (column: Column) => void;
}) {
  const t = S.hub.leaderboards;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useId();
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((value) => !value)}
        className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-sm whitespace-nowrap text-gray-700 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-700"
      >
        {t.columns}
      </button>
      <div
        id={panel}
        role="group"
        aria-label={t.columns}
        hidden={!open}
        className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900"
      >
        {OPTIONAL.map((column) => (
          <label
            key={column}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <input
              type="checkbox"
              checked={!hidden.has(column)}
              onChange={() => onToggle(column)}
              className="accent-brand-600"
            />
            {t.columnNames[column]}
          </label>
        ))}
      </div>
    </div>
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
}: {
  entry: LeaderboardEntry;
  locale: SiteLocale;
  benchmarkTitle: (id: string) => string;
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

function PartRow({
  part,
  locale,
  benchmarkTitle,
  setting,
  showSetting,
}: {
  part: LeaderboardPart;
  locale: SiteLocale;
  benchmarkTitle: (id: string) => string;
  setting?: Record<string, unknown>;
  showSetting: boolean;
}) {
  const t = S.hub.leaderboards.raw;
  return (
    <tr className="border-b border-gray-100 last:border-0 dark:border-gray-800">
      <td className={`${TD} min-w-48`}>
        {part.benchmarks.map((id) => (
          <Link
            key={id}
            to={`/benchmarks/${id}`}
            className="block text-brand-700 hover:underline dark:text-brand-300"
          >
            {benchmarkTitle(id)}
          </Link>
        ))}
        <ExternalLink
          href={part.url}
          className="block text-xs text-gray-500 [overflow-wrap:anywhere] hover:underline dark:text-gray-400"
        >
          {part.experimentId}
        </ExternalLink>
        {showSetting && (
          <div className="mt-2 text-xs">
            <p className="text-gray-500 dark:text-gray-400">{t.harnessSetting}</p>
            <Settings setting={setting} />
          </div>
        )}
      </td>
      <td className={`${TD} text-right whitespace-nowrap tabular-nums`}>
        {formatScore(part.value)}
        {part.scoreStd !== null && (
          <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
            ± {formatScore(part.scoreStd)}
          </span>
        )}
      </td>
      <td className={`${TD} text-right tabular-nums`}>{part.attempts}</td>
      <td className={`${TD} text-right whitespace-nowrap tabular-nums`}>{formatUsd(part.cost)}</td>
      <td className={`${TD} text-right whitespace-nowrap tabular-nums`}>
        {formatDuration(part.durationMs)}
      </td>
      <td className={`${TD} text-right whitespace-nowrap tabular-nums`}>
        {[part.inputTokens, part.cacheTokens, part.outputTokens].map(formatCompact).join(" / ")}
      </td>
      <td className={`${TD} whitespace-nowrap`}>{formatDay(part.finished, locale)}</td>
    </tr>
  );
}
