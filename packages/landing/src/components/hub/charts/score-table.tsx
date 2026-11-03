/**
 * The ranking chart (table.yaml): entries best first, each score beside a bar on a fixed 0–100
 * scale, then its cost. Below 640 px the model moves under the method, and the bar and the cost go.
 */
import { Link } from "react-router";
import type { LeaderboardEntry } from "../../../lib/hub/types";
import { formatScore, formatUsd } from "../../../lib/hub/text";
import { S } from "../../../lib/strings";
import { byValue } from "./chart-kit";
import type { NameOf } from "./entry-name";

const TH = "py-2 pr-4 font-medium last:pr-0";
const TD = "py-2.5 pr-4 align-top last:pr-0";

export function ScoreTable({
  entries,
  nameOf,
}: {
  entries: readonly LeaderboardEntry[];
  nameOf: NameOf;
}) {
  const t = S.hub.leaderboards;
  const rows = byValue(entries);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <th scope="col" className={`${TH} w-px whitespace-nowrap`}>
            {t.rank}
          </th>
          <th scope="col" className={TH}>
            {t.method}
          </th>
          <th scope="col" className={`${TH} hidden sm:table-cell`}>
            {t.model}
          </th>
          <th scope="col" className={TH}>
            {t.score}
          </th>
          <th scope="col" className={`${TH} hidden text-right whitespace-nowrap sm:table-cell`}>
            {t.cost}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) => {
          const name = nameOf(entry);
          const rank = 1 + rows.filter((other) => other.value > entry.value).length;
          const share = Math.max(0, Math.min(100, entry.value));
          return (
            <tr
              key={entry.key}
              className="border-b border-gray-100 last:border-0 dark:border-gray-900"
            >
              <td className={`${TD} text-gray-500 tabular-nums dark:text-gray-400`}>{rank}</td>
              <td className={`${TD} [overflow-wrap:anywhere]`}>
                {name.methodHref ? (
                  <Link
                    to={name.methodHref}
                    className="font-medium text-brand-700 hover:underline dark:text-brand-300"
                  >
                    {name.method}
                  </Link>
                ) : (
                  <span className="font-medium">{name.method}</span>
                )}
                <div className="text-xs leading-5 text-gray-500 sm:hidden dark:text-gray-400">
                  {name.model}
                </div>
              </td>
              <td
                className={`${TD} hidden text-gray-600 [overflow-wrap:anywhere] sm:table-cell dark:text-gray-400`}
              >
                {name.model}
              </td>
              <td className={TD}>
                <div className="flex items-center gap-3">
                  <span className="w-10 shrink-0 font-medium tabular-nums">
                    {formatScore(entry.value)}
                  </span>
                  <span className="w-11 shrink-0 text-xs text-gray-500 tabular-nums dark:text-gray-400">
                    {entry.std !== null && (
                      <>
                        <span aria-hidden>± {formatScore(entry.std)}</span>
                        <span className="sr-only">{t.std(formatScore(entry.std))}</span>
                      </>
                    )}
                  </span>
                  <span
                    aria-hidden
                    className="hidden h-1.5 w-32 shrink-0 overflow-hidden rounded-xs bg-gray-100 sm:block xl:w-40 dark:bg-gray-800"
                  >
                    <span
                      className="block h-full rounded-xs bg-brand-600 dark:bg-brand-300"
                      style={{ width: `${share}%` }}
                    />
                  </span>
                </div>
              </td>
              <td
                className={`${TD} hidden text-right whitespace-nowrap tabular-nums sm:table-cell`}
              >
                {formatUsd(entry.cost)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
