/**
 * A word pronunciation's sounds with the one being said marked as its recording plays, then the
 * whole word: the highlighting a child sees in the book, checked here first. A recording
 * without sound timings says so rather than showing sounds that never light up.
 */
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import { InfoPopover } from "../../components/ui/info-popover";
import { S } from "../../lib/strings";
import { activeCue, wordTimeline } from "./phoneme-timeline";

type MediaAsset = AssetManifest["assets"][string][number];

export function PhonemeTimelineView({
  asset,
  seconds,
}: {
  asset: MediaAsset;
  /** Where the recording's player is, in seconds. */
  seconds: number;
}) {
  const words = S.activities.bookWords;
  const cues = wordTimeline(asset);
  const current = cues ? activeCue(cues, seconds * 1000) : -1;
  return (
    <section className="space-y-1" aria-label={words.timeline}>
      <p className="flex items-center gap-1 text-xs font-medium">
        {words.timeline}
        <InfoPopover label={words.timeline}>
          <p>{words.timelineAbout}</p>
        </InfoPopover>
      </p>
      {cues ? (
        <ol aria-label={words.timelineList} className="flex flex-wrap items-center gap-1 text-sm">
          {cues.map((cue, index) => {
            const start = (cue.startMs / 1000).toFixed(2);
            return (
              <li
                key={`${index}-${cue.startMs}`}
                aria-current={index === current ? "true" : undefined}
                aria-label={
                  cue.whole ? words.wholeWordAt(cue.label, start) : words.soundAt(cue.label, start)
                }
                className={`rounded border px-1.5 ${cue.whole ? "ml-2" : ""} ${
                  index === current
                    ? "border-brand-300 bg-brand-50 font-semibold text-brand-700 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-200"
                    : "border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-300"
                }`}
              >
                {cue.label}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-xs text-gray-500">{words.noTimings}</p>
      )}
    </section>
  );
}
