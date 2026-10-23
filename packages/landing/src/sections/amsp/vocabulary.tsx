/**
 * Every record and event, one ruled row per group of lib/amsp-vocabulary.ts: the envelope `type`,
 * its `payload.type` values, whether the Trace stores it, which stream carries it and what it
 * means. A table from `md` up; on a phone each row stacks into three lines.
 */
import { S } from "../../lib/strings";
import { VOCABULARY } from "../../lib/amsp-vocabulary";
import type { VocabularyRow } from "../../lib/amsp-vocabulary";
import { Section } from "../../components/section";

function Kinds({ row }: { row: VocabularyRow }) {
  if (row.kinds.length === 0) return <span aria-hidden="true">—</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {row.kinds.map((kind) => (
        <span key={kind}>{kind}</span>
      ))}
    </span>
  );
}

/** "stored" in ink, "live only" muted: the same split the player draws with its faint ground. */
function Trace({ stored }: { stored: boolean }) {
  const V = S.amsp.vocabulary;
  return stored ? (
    <span className="font-medium text-gray-900 dark:text-gray-100">{V.stored}</span>
  ) : (
    <span className="text-gray-500 dark:text-gray-400">{V.live}</span>
  );
}

export function AmspVocabulary() {
  const V = S.amsp.vocabulary;
  return (
    <Section id="vocabulary" title={V.title} subtitle={V.subtitle}>
      <table className="hidden w-full text-left text-sm leading-6 md:table">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <th className="py-2 pr-6 font-mono font-medium">{V.head.envelope}</th>
            <th className="w-[34%] py-2 pr-6 font-mono font-medium">{V.head.kinds}</th>
            <th className="py-2 pr-6 font-medium">{V.head.trace}</th>
            <th className="py-2 pr-6 font-medium">{V.head.stream}</th>
            <th className="py-2 font-medium">{V.head.meaning}</th>
          </tr>
        </thead>
        <tbody>
          {VOCABULARY.map((row) => (
            <tr key={row.id} className="border-b border-gray-200 align-top dark:border-gray-800">
              <td className="py-3 pr-6 font-mono font-semibold whitespace-nowrap">
                {row.envelope}
              </td>
              <td className="py-3 pr-6 font-mono text-[13px] text-gray-600 dark:text-gray-300">
                <Kinds row={row} />
              </td>
              <td className="py-3 pr-6 whitespace-nowrap">
                <Trace stored={row.stored} />
              </td>
              <td className="py-3 pr-6 whitespace-nowrap text-gray-700 dark:text-gray-300">
                {V.streams[row.stream]}
              </td>
              <td className="py-3 text-gray-600 dark:text-gray-300">{V.meaning[row.id]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-gray-200 border-y border-gray-200 md:hidden dark:divide-gray-800 dark:border-gray-800">
        {VOCABULARY.map((row) => (
          <li key={row.id} className="py-3 text-sm leading-6">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono font-semibold">{row.envelope}</span>
              <span className="text-xs">
                <Trace stored={row.stored} />
                <span className="text-gray-500 dark:text-gray-400"> · {V.streams[row.stream]}</span>
              </span>
            </div>
            <div className="mt-1 font-mono text-[13px] text-gray-600 dark:text-gray-300">
              <Kinds row={row} />
            </div>
            <p className="mt-1 text-gray-600 dark:text-gray-300">{V.meaning[row.id]}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
