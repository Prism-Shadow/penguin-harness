/**
 * The details card's background processes (e.g. a dev server on localhost:3000), hidden entirely
 * while there are none.
 */
import type { SessionProcessInfo } from "@prismshadow/penguin-server/api";
import { Dot } from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import { formatDateTime } from "../../../lib/format";
import { Truncated } from "../../../components/ui/truncated";

export interface ProcessListProps {
  processes: SessionProcessInfo[];
  /** The rows whose Stop / Remove requests are in flight (every exited row while "clear exited" runs). */
  procBusy: readonly string[] | null;
  exitedIds: readonly string[];
  /** A running row's Stop: asks first (the confirmation is one of the page's dialogs). */
  onAskStop: (process: SessionProcessInfo) => void;
  onRemoveProcess: (processId: string) => Promise<void>;
  onClearExitedProcesses: () => Promise<void>;
}

export function ProcessList({
  processes,
  procBusy,
  exitedIds,
  onAskStop,
  onRemoveProcess,
  onClearExitedProcesses,
}: ProcessListProps) {
  if (processes.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{S.chat.processList}</p>
        {/* Only while something has exited. Words rather than a glyph, in the quiet
            text-action style of the memory card's "Open memory list": the same
            text size as the heading beside it, so the heading row keeps its height
            when the first process exits. The same no-confirm tidy-up as a single
            row's Remove, and its hint, like that button's, says what leaves with
            the rows. */}
        {exitedIds.length > 0 && (
          <button
            type="button"
            data-tooltip={S.chat.processClearExitedHint}
            disabled={procBusy !== null}
            onClick={() => void onClearExitedProcesses()}
            className="shrink-0 cursor-pointer whitespace-nowrap text-xs text-gray-400 transition-colors duration-150 hover:text-gray-600 disabled:cursor-default disabled:opacity-60 dark:text-gray-500 dark:hover:text-gray-300"
          >
            {S.chat.processClearExited}
          </button>
        )}
      </div>
      <ul className="mt-1 space-y-1.5">
        {processes.map((p) => (
          <li key={p.processId} className="flex items-center gap-2">
            {p.running ? (
              <Dot tone="success" pulse />
            ) : (
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600"
              />
            )}
            <span className="min-w-0 flex-1">
              <Truncated text={p.cmd} className="font-mono text-xs" codeTooltip />
              <span className="block truncate text-xs text-gray-400 dark:text-gray-500">
                {formatDateTime(p.startedAt)}
                {p.pid !== null && ` · pid ${p.pid}`}
                {/* Detected service URL (output scan or port probe), running rows
                    only — an exited process serves nothing to open. Scheme dropped
                    at this size; the tooltip and the link carry the full URL. */}
                {p.running && p.serviceUrl !== undefined && (
                  <>
                    {" · "}
                    <a
                      href={p.serviceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-tooltip={p.serviceUrl}
                      className="text-gray-500 underline decoration-gray-300 underline-offset-2 transition-colors duration-150 hover:text-gray-700 hover:decoration-gray-500 dark:text-gray-400 dark:decoration-gray-600 dark:hover:text-gray-200"
                    >
                      {p.serviceUrl.replace(/^https?:\/\//i, "")}
                    </a>
                  </>
                )}
              </span>
            </span>
            {p.running ? (
              <button
                type="button"
                disabled={procBusy !== null}
                onClick={() => onAskStop(p)}
                className="shrink-0 whitespace-nowrap rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-600 transition-colors duration-150 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-default disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              >
                {procBusy?.includes(p.processId) ? S.common.loading : S.chat.processStop}
              </button>
            ) : (
              <>
                <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                  {S.chat.processExited}
                </span>
                {/* The row is the only handle on that process's captured
                    output — removing the entry drops it from the runtime
                    registry, so the model can no longer be asked to read it
                    (input_command answers "unknown process_id"). No confirm
                    step for a one-click tidy-up of a dead row, but the title
                    says what leaves with it. */}
                <button
                  type="button"
                  data-tooltip={S.chat.processRemoveHint}
                  disabled={procBusy !== null}
                  onClick={() => void onRemoveProcess(p.processId)}
                  className="shrink-0 whitespace-nowrap rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-600 transition-colors duration-150 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-default disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                >
                  {procBusy?.includes(p.processId) ? S.common.loading : S.chat.processRemove}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
