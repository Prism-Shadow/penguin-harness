/**
 * The words of an accepted narration with the one being spoken marked as its clip plays:
 * the read-along highlighting an author can check before the book does it. A clip without
 * timings says so rather than showing words that never light up.
 */
import { InfoPopover } from "../../components/ui/info-popover";
import { S } from "../../lib/strings";
import { activeWord } from "./speech-provider";

export function WordTimingsView({
  timings,
  seconds,
}: {
  timings: readonly { word: string; startMs: number; endMs: number }[] | undefined;
  /** Where the clip's player is, in seconds. */
  seconds: number;
}) {
  const words = S.activities.speechProvider;
  const current = timings?.length ? activeWord(timings, seconds * 1000) : -1;
  return (
    <section className="space-y-1" aria-label={words.timings}>
      <p className="flex items-center gap-1 text-xs font-medium">
        {words.timings}
        <InfoPopover label={words.timings}>
          <p>{words.timingsAbout}</p>
        </InfoPopover>
      </p>
      {timings?.length ? (
        <ol aria-label={words.timingsList} className="flex flex-wrap gap-1 text-sm">
          {timings.map((timing, index) => (
            <li
              key={`${index}-${timing.startMs}`}
              aria-current={index === current ? "true" : undefined}
              aria-label={words.word(timing.word, (timing.startMs / 1000).toFixed(2))}
              className={`rounded px-1 ${
                index === current
                  ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-200"
                  : "text-gray-700 dark:text-gray-300"
              }`}
            >
              {timing.word}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-gray-500">{words.noTimings}</p>
      )}
    </section>
  );
}
