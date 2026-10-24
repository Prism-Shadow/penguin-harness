/**
 * A round's readings on demand: the context ring at the end of a round's row is a button, and the
 * panel it opens lists the exact figures, each once — input, cache hits with their rate, cache
 * misses, output and output speed (the round's throughput, summed over its requests, as the
 * global summary sums them), then the context usage the ring draws (the snapshot at the round's
 * last request, against the window). The panel names the round, so its labels are the global
 * summary's own.
 *
 * No token figure is printed on the row itself. Hovering the ring gives the percentage; the
 * figures are a click away. A pure compaction round has no snapshot: a tokens glyph stands where
 * the ring would, and its panel lists the throughput alone (its TPS is how fast the summary was
 * written, which is worth reading).
 */
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import {
  GlyphIcon,
  ICON_SIZE,
  KeyValue,
  KeyValueRow,
  TokenDonut,
  usePortalPanel,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { computeTps, formatPercent, formatTps, humanizeTokens } from "../../lib/format";
import { STAT_ICONS } from "../../lib/stat-icons";
import { hitRateOf, inputOf } from "./round-facts";
import type { Buckets } from "./round-facts";

/** Panel geometry in real pixels: usePortalPanel clamps the left edge with this width. */
const PANEL_WIDTH = 264;
/** Only decides whether the panel opens up or down: six rows. */
const PANEL_HEIGHT = 160;

export interface ReadingRow {
  label: string;
  value: string;
}

export interface RoundReadings {
  /** The panel's rows, in order; the context usage last, and only with a snapshot. */
  rows: ReadingRow[];
  /** The snapshot's share of the window (0–1); null with no snapshot. */
  usage: number | null;
}

/** What a round's readings panel lists, from the analysis' figures for that round. */
export function roundReadingRows(
  tokens: Buckets,
  llmMs: number,
  ctx: Buckets | null | undefined,
  contextMax: number,
): RoundReadings {
  const rows: ReadingRow[] = [
    { label: S.chat.statInput, value: humanizeTokens(inputOf(tokens)) },
    {
      label: S.traces.cacheHit,
      value: `${humanizeTokens(tokens.cacheRead)} · ${formatPercent(hitRateOf(tokens))}`,
    },
    { label: S.traces.cacheMiss, value: humanizeTokens(tokens.cacheWrite) },
    { label: S.chat.statOutput, value: humanizeTokens(tokens.output) },
    { label: S.chat.statTps, value: formatTps(computeTps(tokens.output, llmMs)) },
  ];
  if (ctx === null || ctx === undefined) return { rows, usage: null };
  const used = ctx.cacheRead + ctx.cacheWrite + ctx.output;
  const usage = contextMax > 0 ? used / contextMax : null;
  rows.push({
    label: S.chat.contextUsage,
    value: `${humanizeTokens(used)} / ${humanizeTokens(contextMax)} · ${formatPercent(usage)}`,
  });
  return { rows, usage };
}

/**
 * The ring at the end of a round's row, as the button that opens the round's readings. The ring
 * draws the snapshot against the Session's window; its own name and hint are off, since the
 * button carries both — the percentage, nothing more.
 */
export function ContextRingButton({
  tokens,
  llmMs,
  ctx,
  contextMax,
}: {
  tokens: Buckets;
  llmMs: number;
  ctx: Buckets | null | undefined;
  contextMax: number;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { triggerRef, panelRef, position } = usePortalPanel({
    open,
    onClose: () => setOpen(false),
    estimatedHeight: PANEL_HEIGHT,
    panelWidth: PANEL_WIDTH,
  });
  const readings = roundReadingRows(tokens, llmMs, ctx, contextMax);
  const name =
    readings.usage === null
      ? S.traces.roundReadings
      : `${S.chat.contextUsage} ${formatPercent(readings.usage)}`;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-slot="ring"
        aria-label={name}
        data-tooltip={name}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 items-center justify-center rounded-full p-1 text-fg-subtle transition-colors duration-150 hover:bg-control-hover hover:text-fg-muted"
      >
        {ctx ? (
          <TokenDonut
            cacheRead={ctx.cacheRead}
            cacheWrite={ctx.cacheWrite}
            output={ctx.output}
            max={contextMax}
            size={18}
            labels={{
              usage: S.chat.contextUsage,
              cacheRead: S.usage.colCacheRead,
              cacheWrite: S.usage.colCacheWrite,
              output: S.usage.colOutput,
            }}
            format={humanizeTokens}
            hint={false}
          />
        ) : (
          <GlyphIcon d={STAT_ICONS.tokens} size={ICON_SIZE.iconButton} />
        )}
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="group"
            aria-label={S.traces.roundReadings}
            style={{
              position: "fixed",
              top: position.topPx,
              bottom: position.bottomPx,
              left: position.left,
              width: PANEL_WIDTH,
              maxWidth: "calc(100vw - 32px)",
            }}
            className="anim-pop z-[60] max-h-[70vh] overflow-y-auto rounded-md border border-line bg-overlay p-3 text-xs shadow-lg"
          >
            <KeyValue size="xs">
              {readings.rows.map((r) => (
                <KeyValueRow key={r.label} label={r.label}>
                  {r.value}
                </KeyValueRow>
              ))}
            </KeyValue>
          </div>,
          document.body,
        )}
    </>
  );
}
