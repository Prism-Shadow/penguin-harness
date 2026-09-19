/**
 * `/screens/traces` — the same run observed from its Trace: the chat keeps the upper third, and
 * the bottom dock holds the Trajectories panel on file #001 — the file switcher and export, the
 * Overall summary, turn 2 opened on its execution timeline (a lane per tool, an approval wait
 * still open) with the legend and its event rows, and turn 1 collapsed.
 */
import { fixturesFor } from "../fixtures";
import type { FixtureLang, Fixtures, TraceSegmentKind, TraceTurn } from "../fixtures";
import { ChatTranscript } from "./chat";
import { bytes, duration, percent, tokens, usd } from "./format";
import { Glyph } from "./glyph";
import { AppShell, Badge, ChatHeader, DockFrame, NEUTRAL_FILL, Sidebar, StatChip } from "./parts";
import { Composer } from "./transcript";

/** Timeline phase inks: chart identity colours, one per kind; `other` recedes. */
const SEGMENT_INK: Record<TraceSegmentKind, string> = {
  thinking: "bg-chart-5",
  text: "bg-chart-1",
  toolgen: "bg-chart-2",
  approvalWait: "bg-chart-4",
  exec: "bg-chart-6",
  other: "bg-tone-neutral-emphasis",
};

const LEGEND_ORDER: readonly TraceSegmentKind[] = [
  "thinking",
  "text",
  "toolgen",
  "approvalWait",
  "exec",
  "other",
];

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-xs text-fg-subtle">{label}</span>
      <span className="truncate font-mono text-sm font-(--ui-weight-strong) tabular-nums text-fg">
        {value}
      </span>
    </div>
  );
}

/**
 * The Trace's totals as a ruled section, not a card: a bordered box inside the dock frame would be
 * a second surface for a title and a grid of pairs (§1.3 row 16).
 */
function Overall({ f }: { f: Fixtures }) {
  const o = f.trace.overall;
  const t = f.copy.traces;
  return (
    <section className="border-t border-line pt-3">
      <p className="mb-2 text-xs font-(--ui-weight-strong) text-fg-muted">{t.overall}</p>
      <div className="grid grid-cols-3 gap-x-6 gap-y-1">
        <div>
          <SummaryRow label={t.turns} value={String(o.turns)} />
          <SummaryRow label={t.toolCalls} value={String(o.toolCalls)} />
          <SummaryRow label={t.compactions} value={String(o.compactions)} />
        </div>
        <div>
          <SummaryRow label={t.inputTokens} value={tokens(o.inputTokens)} />
          <SummaryRow
            label={t.cacheHits}
            value={`${tokens(o.cacheReadTokens)} · ${percent(o.cacheReadTokens, o.inputTokens)}`}
          />
          <SummaryRow label={t.outputTokens} value={tokens(o.outputTokens)} />
        </div>
        <div>
          <SummaryRow label={t.cost} value={usd(o.costUsd)} />
          <SummaryRow label={t.elapsed} value={duration(o.elapsedMs)} />
          <SummaryRow label={t.outputTps} value={`${o.outputTps} tok/s`} />
        </div>
      </div>
    </section>
  );
}

/** The execution timeline sits in the turn's body under a hairline, not in a box of its own. */
function Timeline({ turn, f }: { turn: TraceTurn; f: Fixtures }) {
  const t = f.copy.traces;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="space-y-3">
      <p className="text-xs font-(--ui-weight-medium) text-fg-muted">{t.timeline}</p>
      <div className="space-y-1">
        {turn.lanes.map((lane) => (
          <div key={lane.name} className="flex items-center">
            <span className="flex h-4 w-[6.5rem] shrink-0 items-center justify-end pr-2">
              <span className="truncate font-mono text-xs text-fg-muted">
                {lane.name === "model"
                  ? t.modelLane
                  : lane.name === "other"
                    ? t.legend.other
                    : lane.name}
              </span>
            </span>
            <div className={`relative h-4 min-w-0 flex-1 overflow-hidden ${NEUTRAL_FILL}`}>
              {lane.segments.map((seg, i) => (
                <span
                  key={i}
                  className={`absolute inset-y-0 min-w-[2px] ${SEGMENT_INK[seg.kind]}`}
                  style={{
                    left: `${(seg.startMs / turn.spanMs) * 100}%`,
                    width: `${((seg.endMs - seg.startMs) / turn.spanMs) * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="flex items-center">
          <span className="w-[6.5rem] shrink-0" />
          <div className="relative h-4 min-w-0 flex-1">
            {ticks.map((p) => (
              <span
                key={p}
                className={`absolute top-0 font-mono text-xs text-fg-subtle ${
                  p === 0 ? "" : p === 1 ? "-translate-x-full" : "-translate-x-1/2"
                }`}
                style={{ left: `${p * 100}%` }}
              >
                {duration(Math.round(turn.spanMs * p))}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-muted pt-3">
        {LEGEND_ORDER.map((kind) => (
          <span key={kind} className="flex items-center gap-1 px-1 font-mono text-xs text-fg-muted">
            <span className={`inline-block h-2 w-3 rounded-xs ${SEGMENT_INK[kind]}`} />
            {t.legend[kind]}
          </span>
        ))}
      </div>
    </div>
  );
}

const TYPE_TONE = {
  session_meta: "info",
  model_msg: "neutral",
  event_msg: "attention",
} as const;

function TurnCard({
  turn,
  f,
  open,
  running,
}: {
  turn: TraceTurn;
  f: Fixtures;
  open: boolean;
  running: boolean;
}) {
  const t = f.copy.traces;
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="flex w-full items-center gap-2 border-b border-line bg-surface-muted px-3 py-2">
        <Glyph name={open ? "chevronDown" : "chevronRight"} size={13} className="text-fg-subtle" />
        <span className="shrink-0 text-sm font-(--ui-weight-strong) text-fg">
          {t.turn(turn.index)}
        </span>
        {running && <Badge tone="success">{f.copy.chat.runStates.running}</Badge>}
        <span className="min-w-0 flex-1" />
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-fg-muted">
          <StatChip glyph="wrench" value={String(turn.toolCalls)} title={t.toolCalls} />
          <StatChip
            glyph="arrowUpLine"
            value={`${tokens(turn.inputTokens)} (${percent(turn.cacheReadTokens, turn.inputTokens)})`}
            title={t.inputTokens}
          />
          <StatChip
            glyph="arrowDownLine"
            value={tokens(turn.outputTokens)}
            title={t.outputTokens}
          />
          <StatChip glyph="cost" value={usd(turn.costUsd)} title={t.cost} />
          <StatChip glyph="clock" value={duration(turn.elapsedMs)} title={t.elapsed} />
          <StatChip glyph="gauge" value={`${turn.outputTps} tok/s`} title={t.outputTps} />
        </span>
      </div>
      {open && (
        <div className="space-y-3 bg-surface p-3">
          <Timeline turn={turn} f={f} />
          <div>
            <p className="mb-1.5 text-xs font-(--ui-weight-medium) text-fg-muted">{t.messages}</p>
            <ul className="divide-y divide-line-muted rounded-md border border-line">
              {turn.events.map((ev, i) => (
                <li
                  key={i}
                  // The row a hovered timeline segment points at is cross-highlighted.
                  className={`flex items-center gap-2 px-3 py-1.5 ${
                    i === 2 ? "bg-tone-attention-bg" : ""
                  }`}
                >
                  <span className="shrink-0 font-mono text-xs tabular-nums text-fg-subtle">
                    {ev.time}
                  </span>
                  <Badge tone={TYPE_TONE[ev.messageType]}>{ev.payloadType}</Badge>
                  {ev.fromSubagent && <Badge tone="done">{t.fromSubagent}</Badge>}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
                    {ev.summary}
                  </span>
                  {ev.stopReason && (
                    <span className="shrink-0 font-mono text-xs text-fg-subtle">
                      {ev.stopReason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function TracePanel({ f }: { f: Fixtures }) {
  const tr = f.trace;
  const t = f.copy.traces;
  const active = tr.files[tr.activeFile]!;
  const [turn1, turn2] = tr.turns;
  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-fg-subtle">{t.filesTitle}</span>
          {tr.files.map((file, i) => (
            <span
              key={file.label}
              role="button"
              className={`rounded-md border px-2 py-0.5 font-mono text-xs ${
                i === tr.activeFile
                  ? "border-line-emphasis bg-accent-muted font-(--ui-weight-strong) text-fg"
                  : "border-line text-fg-muted hover:text-fg"
              }`}
            >
              {file.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-fg-muted">
            {active.dateIso} · {bytes(active.sizeBytes)}
          </span>
          <span className="min-w-0 flex-1" />
          <span
            role="button"
            className="flex items-center gap-1.5 rounded-control border border-line-emphasis bg-surface px-2.5 py-1 text-xs font-(--ui-weight-medium) text-fg"
          >
            <Glyph name="download" size={13} />
            {t.export}
          </span>
        </div>
        <Overall f={f} />
        <TurnCard turn={turn2!} f={f} open running />
        <TurnCard turn={turn1!} f={f} open={false} running={false} />
      </div>
    </div>
  );
}

export function TracesScreen({ lang }: { lang: FixtureLang }) {
  const f = fixturesFor(lang);
  return (
    <AppShell className="flex h-screen w-full overflow-hidden bg-canvas text-fg">
      <Sidebar f={f} activeSessionId={f.session.id} />
      <div data-slot="main" className="flex min-w-0 flex-1 flex-col">
        <ChatHeader f={f} dock="bottom" />
        <main className="flex h-[34%] min-h-0 shrink-0 flex-col">
          <ChatTranscript f={f} />
          <Composer f={f} compact />
        </main>
        <div className="flex min-h-0 flex-1">
          <DockFrame f={f} tab={f.copy.nav.traces} glyph="eye" edge="bottom">
            <TracePanel f={f} />
          </DockFrame>
        </div>
      </div>
    </AppShell>
  );
}
