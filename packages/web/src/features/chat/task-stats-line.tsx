/**
 * Task stats line: after each Task finishes, shows "this turn's usage" at the
 * **bottom-left** of the AI reply — input, output, output TPS, elapsed time, and cost (converted
 * in real time from the current Model's pricing, hidden if no pricing is configured); all five
 * share the same basis (this turn's usage), each expressed uniformly as icon + value (no text
 * labels); the reply timestamp and a copy button sit at the end (copies this turn's assistant
 * text, falling back to the stats themselves when there's no text), with the fork action to the
 * right of copy — forking asks for confirmation first (it duplicates the conversation into a new
 * Session up to this reply), while copy stays a plain immediate click. Below sm the row is slimmed
 * to fit the width: the TPS chip is dropped and cost/elapsed lose excess decimals (compact
 * formatter variants); desktop shows all five, formatted as always.
 * At ≥sm the whole line is invisible but takes up space by default, surfacing only on hovering
 * the reply or the line itself — matching the same convention, font size, and color as the user
 * message footer: the AI's footer sits bottom-left, the user's sits bottom-right, symmetric on
 * both sides. Below sm the line is always visible: phones have no hover (Tailwind v4 even gates
 * hover: variants behind `@media (hover: hover)`), so a hover-revealed footer would simply
 * never appear there.
 * Arrow direction reads as "where the tokens go": **up arrow = input** (sent up to the model),
 * **down arrow = output** (returned by the model).
 * This line only answers "how much did this turn cost", **it doesn't break down the cache
 * composition** — how much of the input hit cache is a debugging-level detail that belongs to the
 * Trace page's turn card (which shows cache hits and hit rate); the current **context usage** is
 * likewise not repeated here — it's expressed by the ring below the input box (see ContextGauge
 * in context-gauge), which also discloses what that context is made of.
 * This line sits right below this turn's AI reply and simultaneously **serves as that reply's
 * footer**: it provides the reply timestamp and copy button at the end, so the assistant message
 * itself doesn't render a separate one (otherwise two copy buttons would pop up in the same spot).
 */
import { useState } from "react";
import type { TracePosition } from "@prismshadow/penguin-server/api";
import { formatTaskStats } from "../../lib/omni/task-stats";
import type { TaskStats } from "../../lib/omni/task-stats";
import {
  formatMessageTime,
  formatMoney,
  formatTps,
  humanizeDuration,
  humanizeTokens,
} from "../../lib/format";
import { STAT_ICONS } from "../../lib/stat-icons";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { CopyButton } from "../../components/ui/copy-button";
import { useTheme } from "../../state/theme";
import { useLocale } from "../../state/locale";

export interface ForkTarget {
  assistantText: string;
  atMs?: number;
  position?: TracePosition;
}

/**
 * Icon + value; hover explains what this item is (the icon alone doesn't convey the exact
 * meaning). `display` swaps the default `flex` for a responsive variant (the TPS chip is
 * `hidden sm:flex`); `compactValue`, when it differs, replaces the value below sm — fewer
 * decimals so the one-line stats row fits a phone without needing its scroll fallback.
 */
function StatChip({
  icon,
  value,
  compactValue,
  label,
  display = "flex",
}: {
  icon: string;
  value: string;
  compactValue?: string;
  label: string;
  display?: string;
}) {
  return (
    <span title={label} aria-label={label} className={`${display} items-center gap-1`}>
      <GlyphIcon d={icon} />
      {compactValue !== undefined && compactValue !== value ? (
        <>
          <span className="sm:hidden">{compactValue}</span>
          <span className="hidden sm:inline">{value}</span>
        </>
      ) : (
        value
      )}
    </span>
  );
}

export function TaskStatsLine({
  stats,
  assistantText,
  cost,
  atMs,
  forkPosition,
  onFork,
}: {
  /** This turn's stats; `null` = no token_usage for this turn (reply was aborted) -> only the timestamp and copy are shown, no stat numbers drawn. */
  stats: TaskStats | null;
  /** This turn's assistant text (the copy target); falls back to the stats when empty. */
  assistantText?: string;
  /** This turn's cost (USD); null = no pricing configured, cost isn't shown. */
  cost?: number | null;
  /** Timestamp of this turn's AI reply (this line is that reply's footer). */
  atMs?: number;
  forkPosition?: TracePosition;
  onFork?: (target: ForkTarget) => Promise<void>;
}) {
  const { currency } = useTheme();
  const { locale } = useLocale();
  const [forking, setForking] = useState(false);
  // Fork is gated behind an explicit confirmation (review request): duplicating a whole
  // conversation is a heavier action than the neighboring copy button suggests, so a stray
  // click must not silently create a Session. Plain copy stays unconfirmed.
  const [confirmingFork, setConfirmingFork] = useState(false);

  // This turn's usage (not a context snapshot): input = this Task's cached + uncached input.
  const b = stats?.tokensByBucket;
  const input = b ? b.cacheRead + b.cacheWrite : 0;

  // Computed at click time (CopyButton takes a getter): the reply text, or the formatted
  // stats line when there's no reply body.
  const copyText = () =>
    assistantText?.trim() || stats === null
      ? (assistantText ?? "")
      : formatTaskStats(stats, {
          stats: S.chat.statsLabel,
          input: S.chat.statInput,
          cached: S.chat.statCached,
          output: S.chat.statOutput,
          parenOpen: S.chat.statParenOpen,
          parenClose: S.chat.statParenClose,
        });

  // ≥sm: invisible but **space-reserved** by default (sm:opacity-0, not hidden) — the user
  // footer's hover-reveal convention; because the space is always reserved, appearing never
  // pushes content below it down. Below sm the line is ALWAYS visible: hover doesn't exist on
  // touch screens (and Tailwind v4 scopes hover: variants to `@media (hover: hover)`), so the
  // hover gating made the stats unreachable on phones.
  // One line always (no flex-wrap): with the fixed h-5, wrapped chips used to paint over the
  // content below on phones. Below sm the row is slimmed to FIT rather than scroll: the TPS
  // chip (the least decision-relevant number here) is dropped, the cost/elapsed values lose
  // excess decimals, and the chip gap tightens one step — the en timestamp + priced row was
  // otherwise ~7px over a 390 viewport. The sideways scroll (hidden scrollbar) stays only as
  // the fallback for extreme values; at ≥sm everything fits and the scroll container is inert.
  // The copy button sits outside the scrollable span, so it stays pinned at the row's end
  // instead of scrolling out of reach.
  return (
    <div className="-mt-2 flex h-5 items-center justify-start gap-x-2 overflow-hidden whitespace-nowrap text-[11px] text-gray-400 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 sm:gap-x-3 sm:opacity-0 dark:text-gray-500">
      <span className="no-scrollbar flex min-w-0 items-center gap-x-2 overflow-x-auto sm:gap-x-3">
        {/* Timestamp leads: it's this reply's identity (when it was said), the stat numbers are an
            annotation. When this turn has no token_usage (reply was aborted), only the timestamp
            and copy remain — nothing is fabricated for what wasn't measured. */}
        {atMs !== undefined && <span>{formatMessageTime(atMs, locale)}</span>}
        {stats && b && (
          <>
            <StatChip
              icon={STAT_ICONS.input}
              value={humanizeTokens(input)}
              label={S.chat.statInput}
            />
            <StatChip
              icon={STAT_ICONS.output}
              value={humanizeTokens(b.output)}
              label={S.chat.statOutput}
            />
            <StatChip
              icon={STAT_ICONS.tps}
              value={formatTps(stats.outputTps)}
              label={S.chat.statTps}
              display="hidden sm:flex"
            />
            {cost != null && (
              <StatChip
                icon={STAT_ICONS.cost}
                value={formatMoney(cost, currency)}
                compactValue={formatMoney(cost, currency, { compact: true })}
                label={`${S.common.cost}（${currency}）`}
              />
            )}
            <StatChip
              icon={STAT_ICONS.elapsed}
              value={humanizeDuration(stats.elapsedDeltaMs)}
              compactValue={humanizeDuration(stats.elapsedDeltaMs, { compact: true })}
              label={S.chat.statElapsed}
            />
          </>
        )}
      </span>
      {/* Pinned at the row's end, outside the scrollable stats span. */}
      <CopyButton
        text={copyText}
        label={S.chat.copyReply}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      />
      {/* Fork sits to the RIGHT of copy (review request): copy is the frequent action and
          keeps its accustomed spot; the click only opens the confirmation below — the fork
          request fires on Confirm, never directly. */}
      {onFork && assistantText?.trim() && (
        <>
          <button
            type="button"
            disabled={forking}
            title={S.chat.forkSession}
            aria-label={S.chat.forkSession}
            onClick={() => setConfirmingFork(true)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-wait disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className={forking ? "animate-pulse" : ""}
            >
              <circle cx="6" cy="5" r="2" />
              <circle cx="18" cy="7" r="2" />
              <circle cx="6" cy="19" r="2" />
              <path d="M6 7v8M8 11h4a6 6 0 0 0 6-2" />
            </svg>
          </button>
          <ConfirmModal
            open={confirmingFork}
            title={S.chat.forkSession}
            tone="primary"
            confirmLabel={S.chat.forkSessionConfirmAction}
            busy={forking}
            onClose={() => setConfirmingFork(false)}
            onConfirm={() => {
              setConfirmingFork(false);
              setForking(true);
              void onFork({
                assistantText,
                ...(atMs !== undefined ? { atMs } : {}),
                ...(forkPosition !== undefined ? { position: forkPosition } : {}),
              }).finally(() => setForking(false));
            }}
          >
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {S.chat.forkSessionConfirmBody}
            </p>
          </ConfirmModal>
        </>
      )}
    </div>
  );
}
