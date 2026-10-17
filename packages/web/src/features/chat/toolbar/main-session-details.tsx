import { SessionStatsList } from "../session-stats";
import {
  ActivityIcon,
  Dot,
  Dropdown,
  GlyphIcon,
  Heading,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  StatChip,
} from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import { formatDateTime } from "../../../lib/format";
import { sessionActivityLabel } from "../../../lib/session-activity";
import { Truncated } from "../../../components/ui/truncated";
import { CostPartsRows, StatHint } from "../../../components/ui/stat-hint";
import { OutlineMenuButton } from "../conversation-outline";
import { nameOnMachine } from "../../../lib/workspace-machines";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { DockToggles } from "../dock-toggles";
import { toneInk } from "../../../lib/tone";
import { STAT_ICONS } from "../../../lib/stat-icons";
import { SessionIdRow } from "../session/main-chat-helpers";
import type { MainChatView } from "../body/main-chat-view";
export function renderMainSessionDetails(scope: MainChatView) {
  const {
    currency,
    infoOpen,
    setInfoOpen,
    processes,
    procBusy,
    setProcToKill,
    usageCostParts,
    selected,
    archivedRow,
    stream,
    outline,
    streamScrollRef,
    railFit,
    machineNameOf,
    onRemoveProcess,
    exitedIds,
    onClearExitedProcesses,
    anySubagentPending,
    hs,
    cacheHitRate,
    usageBuckets,
    sessionAgentName,
    headerActivity,
    backgroundCount,
  } = scope;
  if (!selected) return null;
  return (
    <Dropdown
      open={infoOpen}
      setOpen={setInfoOpen}
      menuClass="right-0 top-full mt-1 w-96 max-w-[calc(100vw-1.5rem)] origin-top-right"
      button={
        <button
          type="button"
          data-tooltip={S.chat.infoPanel}
          aria-label={S.chat.infoPanel}
          aria-expanded={infoOpen}
          onClick={() => setInfoOpen(!infoOpen)}
          className={`flex h-7 shrink-0 items-center rounded-md transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
            infoOpen ? "bg-gray-100 dark:bg-gray-800" : ""
          }`}
        >
          {/* Wide: the chip row, a glyph and a total per chip, each named by its label.
                    No breakdown rides on a chip: a hover hint on a visible reading never opens,
                    and this button holds no "?", so the breakdowns are in the details card it
                    opens. The row sets the chips' face and ink, and keeps each on one line. */}
          <span className="hidden items-center gap-3 whitespace-nowrap px-2 font-mono text-xs text-gray-500 sm:flex dark:text-gray-400">
            <StatChip
              glyph={STAT_ICONS.tokens}
              value={hs.tokensText}
              label={`${S.chat.statTokens}（Token）`}
            />
            {/* When there's no cost (the Model has no pricing configured), don't render
                      this stat at all, rather than showing a "—" — that would take up space
                      while saying nothing, only making people think the cost is zero or
                      something's broken. */}
            {hs.costText != null && (
              <StatChip
                glyph={STAT_ICONS.cost}
                value={`${hs.costText}${hs.costUncosted ? " *" : ""}`}
                label={`${S.common.cost}（${currency}）`}
              />
            )}
            <StatChip
              glyph={STAT_ICONS.elapsed}
              value={hs.elapsedNode}
              label={S.chat.statElapsed}
            />
            {/* Right of the time, only while the conversation still owns background
                      work — command processes past their yield window, background subagents
                      mid-round: their count, in the same tone, figure and glyph as the
                      session row's mark and read live off the row. A count is what this
                      reading is, and a glyph beside a number is how every other chip in this
                      row says what its number counts. Bare ink like the chips beside it, not
                      a tinted pill: this is one more reading in the stat row, not a badge
                      that should out-weigh them. In the live-status green (`busy`), the same
                      tone as the session row's mark: background work is work still running
                      behind this conversation, and glyph and number wear that colour together
                      wherever they appear; the title still names the count in words. */}
            {backgroundCount > 0 && (
              <span
                data-tooltip={S.chat.backgroundTasks(backgroundCount)}
                className={`flex shrink-0 items-center ${ICON_GAP.tight} font-mono text-xs ${toneInk.busy}`}
              >
                <GlyphIcon d={ICONS.pulse} />
                {backgroundCount}
              </span>
            )}
          </span>
          {/* Narrow: the info icon alone (the chips would crowd the title out). */}
          <span className="flex h-7 w-7 items-center justify-center text-gray-500 sm:hidden dark:text-gray-400">
            <GlyphIcon d={ICONS.info} size={ICON_SIZE.navRow} />
          </span>
        </button>
      }
    >
      <div className="space-y-3 px-3.5 py-2.5 text-sm">
        {/* Agent, above the Model: a conversation belongs to an Agent first, and the
                  Model it runs on is one of that Agent's settings. Paired the same way as the
                  Model row — the id the API speaks, then the display name, which is dropped
                  when the Agent has none of its own and the two would simply repeat. */}
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{S.chat.agent}</p>
          <p className="truncate text-xs">
            <span className="font-mono">{selected.agentId}</span>
            {sessionAgentName !== null && (
              <span className="ml-1.5 text-gray-400 dark:text-gray-500">{sessionAgentName}</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{S.chat.model}</p>
          {/* Paired display: upstream model_id + provider name (two separate fields on the Session DTO). */}
          <p className="truncate text-xs">
            <span className="font-mono">{selected.modelId}</span>
            <span className="ml-1.5 text-gray-400 dark:text-gray-500">
              {providerInfo(selected.provider)?.label ?? selected.provider}
            </span>
          </p>
        </div>
        <SessionIdRow sessionId={selected.sessionId} />
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{S.chat.workspace}</p>
          {/* The machine too: a path names a directory only together with the
                    filesystem it is on, and the same path exists on more than one of them. */}
          <p className="break-all font-mono text-xs leading-5">
            {nameOnMachine(selected.workspace, machineNameOf(selected.sessionId))}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{S.common.created}</p>
          <p className="font-mono text-xs">{formatDateTime(selected.createdAt)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {S.chat.sessionStats}
          </p>
          {/* A bulleted list, one stat per line. The tokens bullet carries the cache
                    hit rate in parentheses (cacheRead ÷ all recorded input), and the cost
                    bullet a "?" right of the figure with its priced parts; both come from the
                    usage fetch — recorded usage, without the live estimate the cost adds
                    mid-run — so they can trail the live totals and reconcile on idle. The
                    elapsed bullet prints its API / tool components inline. No-cost sessions
                    omit the cost bullet entirely, as the chip does. Each bullet stays inline
                    content (no flex), which is what keeps its marker. */}
          <SessionStatsList
            tokens={hs.tokensText}
            usage={usageBuckets}
            cost={
              hs.costText != null
                ? { text: hs.costText, uncosted: hs.costUncosted, parts: usageCostParts }
                : null
            }
            currency={currency}
            elapsed={hs.elapsedNode}
            elapsedSplit={hs.elapsedSplit}
          />
        </div>
        {/* Background processes the conversation started (e.g. a dev server on
                  localhost:3000): live rows carry a stop button — the kill signals the whole
                  process group and the row drops on the follow-up refresh; exited rows keep
                  their "exited" label and carry a remove button that deletes the entry from
                  the list (#312), and the heading carries one action removing every exited
                  row at once. A command too long for its row shows whole in a tooltip. Hidden
                  entirely while there are none. */}
        {processes.length > 0 && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {S.chat.processList}
              </p>
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
                  data-tooltip-extra
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
                      onClick={() => setProcToKill(p)}
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
                        data-tooltip-extra
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
        )}
      </div>
    </Dropdown>
  );
}
