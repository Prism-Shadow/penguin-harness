/**
 * A bound audio or video file's details: format, size, length, bitrate and, for video, its
 * dimensions, so an author can spot a clip that is too long, too large or in the wrong
 * format before assembling.
 *
 * Length and dimensions come from the browser loading only the file's metadata through a
 * detached media element, released on unmount. A narration whose waveform is already
 * decoded passes its length in instead, which is exact.
 */
import { useEffect, useState } from "react";
import { S } from "../../lib/strings";
import { fileSizeText } from "./media-library";
import { detailsFor, formatLength, type FileFacts, type MeasuredFacts } from "./media-details";

export function MediaDetailsView({
  kind,
  src,
  file,
  seconds,
}: {
  kind: "audio" | "video";
  /** Where the file plays from; its metadata is read from here. */
  src: string;
  /** Undefined while the file facts load, null when they cannot be known. */
  file: FileFacts | null | undefined;
  /** The length already decoded elsewhere, preferred over measuring. */
  seconds?: number;
}) {
  const words = S.activities.mediaDetails;
  const [measured, setMeasured] = useState<MeasuredFacts>({});
  // Audio has nothing to measure but its length, so a decoded length makes loading moot.
  const lengthKnown = kind === "audio" && seconds !== undefined && seconds > 0;

  useEffect(() => {
    setMeasured({});
    if (lengthKnown) return;
    const element = document.createElement(kind);
    element.preload = "metadata";
    element.muted = true;
    const loaded = () =>
      setMeasured({
        seconds: element.duration,
        ...(element instanceof HTMLVideoElement
          ? { width: element.videoWidth, height: element.videoHeight }
          : {}),
      });
    const failed = () => setMeasured({ seconds: null, width: null, height: null });
    element.addEventListener("loadedmetadata", loaded);
    element.addEventListener("error", failed);
    element.src = src;
    return () => {
      element.removeEventListener("loadedmetadata", loaded);
      element.removeEventListener("error", failed);
      // Drop the source so the browser stops the request and frees the element.
      element.removeAttribute("src");
      element.load();
    };
  }, [kind, src, lengthKnown]);

  const details = detailsFor(file, {
    ...measured,
    ...(seconds !== undefined && seconds > 0 ? { seconds } : {}),
  });
  const show = <T,>(value: T | null | undefined, text: (value: T) => string) =>
    value === undefined ? words.measuring : value === null ? words.unknown : text(value);
  const rows: [string, string][] = [
    [words.format, show(details.format, (key) => words.formats[key])],
    [words.size, show(details.bytes, fileSizeText)],
    [words.length, show(details.seconds, formatLength)],
    [words.bitrate, show(details.kbps, words.kbps)],
  ];
  if (kind === "video") {
    const size =
      details.width === null || details.height === null
        ? null
        : details.width === undefined || details.height === undefined
          ? undefined
          : { width: details.width, height: details.height };
    rows.push([words.dimensions, show(size, (value) => words.pixels(value.width, value.height))]);
  }
  return (
    <section aria-label={words.title} className="space-y-1">
      <h5 className="text-xs font-semibold">{words.title}</h5>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
