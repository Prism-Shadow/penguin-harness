/**
 * Task stats line: after each Task finishes, shows "this turn's usage" at the
 * **bottom-left** of the AI reply — input, output, output TPS, elapsed time, and cost (converted
 * in real time from the current Model's pricing, hidden if no pricing is configured); all five
 * share the same basis (this turn's usage), each expressed uniformly as icon + value (no text
 * labels); the reply timestamp and a copy button sit at the end (copies this turn's assistant
 * text, falling back to the stats themselves when there's no text).
 * The whole line is invisible but takes up space by default, surfacing only on hovering the
 * reply or the line itself — matching the same convention, font size, and color as the user
 * message footer: the AI's footer sits bottom-left, the user's sits bottom-right, symmetric on
 * both sides.
 * Arrow direction reads as "where the tokens go": **up arrow = input** (sent up to the model),
 * **down arrow = output** (returned by the model).
 * This line only answers "how much did this turn cost", **it doesn't break down the cache
 * composition** — how much of the input hit cache is a debugging-level detail that belongs to the
 * Trace page's turn card (which shows cache hits and hit rate); the current **context usage** is
 * likewise not repeated here — it's expressed by the ring below the input box (see ContextGauge
 * in chat-input).
 * This line sits right below this turn's AI reply and simultaneously **serves as that reply's
 * footer**: it provides the reply timestamp and copy button at the end, so the assistant message
 * itself doesn't render a separate one (otherwise two copy buttons would pop up in the same spot).
 */
import { useState } from "react";
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
import { useTheme } from "../../state/theme";
import { useLocale } from "../../state/locale";

/** Icon + value; hover explains what this item is (the icon alone doesn't convey the exact meaning). */
function StatChip({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <span title={label} aria-label={label} className="flex items-center gap-1">
      <GlyphIcon d={icon} />
      {value}
    </span>
  );
}

export function TaskStatsLine({
  stats,
  assistantText,
  cost,
  atMs,
}: {
  /** This turn's stats; `null` = no token_usage for this turn (reply was aborted) -> only the timestamp and copy are shown, no stat numbers drawn. */
  stats: TaskStats | null;
  /** This turn's assistant text (the copy target); falls back to the stats when empty. */
  assistantText?: string;
  /** This turn's cost (USD); null = no pricing configured, cost isn't shown. */
  cost?: number | null;
  /** Timestamp of this turn's AI reply (this line is that reply's footer). */
  atMs?: number;
}) {
  const [copied, setCopied] = useState(false);
  const { currency } = useTheme();
  const { locale } = useLocale();

  // This turn's usage (not a context snapshot): input = this Task's cached + uncached input.
  const b = stats?.tokensByBucket;
  const input = b ? b.cacheRead + b.cacheWrite : 0;

  const copy = () => {
    const text =
      assistantText?.trim() || stats === null ? (assistantText ?? "") : formatTaskStats(stats);
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // The whole line is invisible but **takes up space** by default (opacity-0, not hidden) —
  // matching the user message footer's convention: only appears on hover, and because the space
  // is always reserved, appearing never pushes content below it down. Font size/color also match
  // that footer; the AI's footer sits bottom-left, the user's sits bottom-right, symmetric.
  return (
    <div className="-mt-2 flex h-5 flex-wrap items-center justify-start gap-x-3 text-[11px] text-gray-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 dark:text-gray-500">
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
          />
          {cost != null && (
            <StatChip
              icon={STAT_ICONS.cost}
              value={formatMoney(cost, currency)}
              label={`${S.chat.statCost}（${currency}）`}
            />
          )}
          <StatChip
            icon={STAT_ICONS.elapsed}
            value={humanizeDuration(stats.elapsedDeltaMs)}
            label={S.chat.statElapsed}
          />
        </>
      )}
      <button
        type="button"
        title={copied ? S.chat.copied : S.chat.copyReply}
        aria-label={S.chat.copyReply}
        onClick={copy}
        className="flex h-5 w-5 items-center justify-center rounded transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      >
        <GlyphIcon d={copied ? STAT_ICONS.check : STAT_ICONS.copy} />
      </button>
    </div>
  );
}
