import type { DeployStage } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { S } from "../../lib/strings";
import { toneInk, toneSurface } from "../../lib/tone";
import type { StageRow } from "./deploy-model";

/** One ordered rail for automatic runs and individual stage actions. */
export function DeployTimeline({
  rows,
  advanced,
  disabled,
  onRun,
}: {
  rows: readonly StageRow[];
  advanced: boolean;
  disabled: boolean;
  onRun: (stage: DeployStage) => void;
}) {
  const words = S.activities.deploy;
  return (
    <ol aria-label={words.stagesLabel} className="divide-y divide-gray-100 dark:divide-gray-800/60">
      {rows.map((row, index) => (
        <li
          key={row.stage}
          aria-label={row.label}
          aria-current={row.status === "running" ? "step" : undefined}
          className={`relative flex gap-3 px-4 py-3 ${row.status === "running" ? "bg-gray-50 dark:bg-gray-900" : ""}`}
        >
          <span
            aria-hidden
            className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums ${toneSurface[row.tone]}`}
          >
            {row.status === "done" ? (
              <GlyphIcon d="m5 12 4 4L19 6" />
            ) : row.status === "failed" ? (
              <GlyphIcon d="m7 7 10 10M17 7 7 17" />
            ) : row.status === "running" ? (
              <GlyphIcon className="motion-safe:animate-spin" d="M12 3a9 9 0 1 1-9 9" />
            ) : (
              index + 1
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{row.label}</span>
              <span className={`text-xs ${toneInk[row.tone]}`}>{row.statusText}</span>
            </div>
            {row.error && (
              <p className={`mt-1 break-words text-xs ${toneInk.danger}`}>{row.error}</p>
            )}
            {advanced && (
              <div className="mt-2 flex items-start justify-between gap-3">
                <p
                  id={`deploy-blocker-${row.stage}`}
                  className="text-xs text-gray-500 dark:text-gray-400"
                >
                  {row.blocker}
                </p>
                <Button
                  size="sm"
                  aria-label={words.runStage(row.label)}
                  aria-describedby={row.blocker ? `deploy-blocker-${row.stage}` : undefined}
                  disabled={disabled || row.blocker !== null}
                  onClick={() => onRun(row.stage)}
                >
                  {words.run}
                </Button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
