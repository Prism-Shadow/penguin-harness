/**
 * The line over the plugin market when a source answered with nothing: how many sources, and —
 * one press away, behind 「[详情]」 — which ones and why. A count alone leaves the reader to guess
 * between a network that cannot reach the address and a document the server refused, and those
 * are fixed in different places; the server's own sentence says which.
 *
 * Folded by default: the count is what the page owes every visit, the reasons are for whoever
 * goes looking. The press keeps its word whichever way it stands (its state is `aria-expanded`),
 * and the list stays in the DOM while folded, so `aria-controls` always resolves. Each source is
 * one item: its address, then the reason as the server wrote it — plain text, selectable for an
 * issue — and 「[报告问题]」 after it, since each is a failure the app was told about.
 */
import { useId, useMemo, useState } from "react";
import type { PluginIndexResponse } from "@prismshadow/penguin-server/api";
import { Notice, ReportIssueAction, TextAction, toldReport } from "@prismshadow/penguin-ui";
import { S } from "@prismshadow/penguin-web/internal";

export function SourceFailuresNotice({
  failures,
  className = "",
}: {
  failures: PluginIndexResponse["failures"];
  /** Layout only (a margin). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  // Each report is made when its failure arrives (a new listing), not when it is pressed, so the
  // time it states is when the server said so.
  const reported = useMemo(
    () =>
      failures.map((failure) => ({
        ...failure,
        report: toldReport({
          what: "a plugin index source could not be read",
          detail: failure.error,
          facts: [["Source", failure.source]],
        }),
      })),
    [failures],
  );
  return (
    <Notice tone="attention" className={className}>
      <p>
        {S.pluginRegistry.sourceUnavailable(failures.length)}{" "}
        <TextAction
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((was) => !was)}
        >
          {S.pluginRegistry.sourceDetails}
        </TextAction>
      </p>
      <ul
        id={listId}
        hidden={!open}
        aria-label={S.pluginRegistry.sourceFailures}
        className="mt-1.5 space-y-1.5"
      >
        {reported.map((failure) => (
          <li key={failure.source} className="min-w-0 select-text">
            <span className="font-mono break-all">{failure.source}</span>
            <span className="block break-words">
              {failure.error} <ReportIssueAction report={failure.report} />
            </span>
          </li>
        ))}
      </ul>
    </Notice>
  );
}
