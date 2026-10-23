/**
 * Every record and control frame: one ruled row per group of lib/amsp-vocabulary.ts — the envelope
 * `type`, its `payload.type` values, whether the Trace stores it and what it means — then the four
 * control frames. Tables from `md` up; on a phone each row stacks.
 */
import { S } from "../../lib/strings";
import { CONTROL_FRAMES, VOCABULARY } from "../../lib/amsp-vocabulary";
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

/**
 * "stored" in ink, "live only" muted: the same split the player draws with its faint ground; a
 * record sent only on a first message says so under it.
 */
function Trace({ row }: { row: VocabularyRow }) {
  const V = S.amsp.vocabulary;
  return (
    <span className="flex flex-col">
      {row.stored ? (
        <span className="font-medium text-gray-900 dark:text-gray-100">{V.stored}</span>
      ) : (
        <span className="text-gray-500 dark:text-gray-400">{V.live}</span>
      )}
      {row.firstMessageOnly && (
        <span className="text-xs text-gray-500 dark:text-gray-400">{V.firstMessage}</span>
      )}
    </span>
  );
}

const TH = "py-2 pr-6 font-medium";
const RULE = "border-b border-gray-200 align-top dark:border-gray-800";

export function AmspVocabulary() {
  const V = S.amsp.vocabulary;
  const F = V.frames;
  return (
    <Section id="vocabulary" title={V.title} subtitle={V.subtitle}>
      <table className="hidden w-full text-left text-sm leading-6 md:table">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <th className={`${TH} font-mono`}>{V.head.envelope}</th>
            <th className={`${TH} w-[38%] font-mono`}>{V.head.kinds}</th>
            <th className={TH}>{V.head.trace}</th>
            <th className="py-2 font-medium">{V.head.meaning}</th>
          </tr>
        </thead>
        <tbody>
          {VOCABULARY.map((row) => (
            <tr key={row.id} className={RULE}>
              <td className="py-3 pr-6 font-mono font-semibold whitespace-nowrap">
                {row.envelope}
              </td>
              <td className="py-3 pr-6 font-mono text-[13px] text-gray-600 dark:text-gray-300">
                <Kinds row={row} />
              </td>
              <td className="py-3 pr-6 whitespace-nowrap">
                <Trace row={row} />
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
              <span className="text-right text-xs">
                <Trace row={row} />
              </span>
            </div>
            <div className="mt-1 font-mono text-[13px] text-gray-600 dark:text-gray-300">
              <Kinds row={row} />
            </div>
            <p className="mt-1 text-gray-600 dark:text-gray-300">{V.meaning[row.id]}</p>
          </li>
        ))}
      </ul>

      <h3 className="mt-14 text-lg font-semibold tracking-tight">{F.title}</h3>
      <table className="mt-3 w-full text-left text-sm leading-6">
        <thead className="hidden md:table-header-group">
          <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <th className={TH}>{F.head.frame}</th>
            <th className={TH}>{F.head.data}</th>
            <th className="py-2 font-medium">{F.head.meaning}</th>
          </tr>
        </thead>
        <tbody className="border-t border-gray-200 md:border-t-0 dark:border-gray-800">
          {CONTROL_FRAMES.map((frame) => (
            <tr key={frame.id} className={`${RULE} max-md:block max-md:py-3`}>
              <td className="pr-6 font-mono font-semibold whitespace-nowrap max-md:block md:py-3">
                {frame.wire}
              </td>
              <td className="pr-6 font-mono text-[13px] whitespace-nowrap text-gray-600 max-md:block md:py-3 dark:text-gray-300">
                {frame.data}
              </td>
              <td className="text-gray-600 max-md:block md:py-3 dark:text-gray-300">
                {F.meaning[frame.id]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
