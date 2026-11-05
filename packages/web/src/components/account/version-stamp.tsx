import { formatMonthDay } from "../../lib/format";
import { S } from "../../lib/strings";

/**
 * `vX.Y.Z · Last updated Jul 26`, as two phrases that never break inside: a line too narrow for
 * both wraps between them, so the date phrase moves to the next line whole rather than splitting
 * after "Last updated". The date is the running build's release date (core's BUILD_DATE); a dev
 * build has none and shows the version alone. The caller's element sets the size and ink.
 */
export function VersionStamp({
  version,
  buildDate,
  locale,
}: {
  version: string;
  buildDate: string | null;
  locale: "zh" | "en";
}) {
  if (buildDate === null) return <span className="whitespace-nowrap">{`v${version}`}</span>;
  return (
    <>
      <span className="whitespace-nowrap">{`v${version} ·`}</span>{" "}
      <span className="whitespace-nowrap">
        {S.update.lastUpdated(formatMonthDay(buildDate, locale))}
      </span>
    </>
  );
}
