/**
 * The transcript and composer pieces of the screen mock-ups, after the web app's chat feature:
 * user bubbles, settled and streaming assistant text, the "Running / Done" work group with its
 * thinking and tool rows, a diff, the subagent row, the pending-approval block, the per-turn stats
 * line and the composer. All W6 components in the architecture; until then these static stand-ins
 * are what the gallery shows.
 *
 * Pieces that carry a style hook take the name of the component they imitate — `DiffViewer`,
 * `ComposerCard`, `WorkGroup` — because a hook belongs to its host (hooks.ts, Appendix B).
 */
import type { ReactNode } from "react";
import type {
  ChatItem,
  ChatTurn,
  FileDiff,
  Fixtures,
  ThinkingItem,
  ToolCallItem,
  TurnStats,
} from "../fixtures";
import { duration, liveDuration, messageTime, tokens, usd } from "./format";
import { Glyph } from "./glyph";
import { Markdown, StreamingCaret } from "./markdown";
import {
  AgentTile,
  Dot,
  IconButton,
  NEUTRAL_FILL,
  Spinner,
  StatChip,
  StatusMark,
  stateWord,
} from "./parts";

/** What a screen asks to see expanded: item ids of rows, and the first item id of work groups. */
export interface Expansion {
  rows?: ReadonlySet<string>;
  groups?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Bubbles and text
// ---------------------------------------------------------------------------

function UserBubble({
  item,
  dense,
}: {
  item: Extract<ChatItem, { kind: "user" }>;
  dense: boolean;
}) {
  return (
    <div className={`${dense ? "my-2" : "my-4"} flex flex-col items-end`}>
      <div
        className={`max-w-[85%] rounded-lg ${NEUTRAL_FILL} ${dense ? "px-3 py-2" : "px-4 py-2.5"}`}
      >
        <p
          className={`whitespace-pre-wrap leading-relaxed text-fg [overflow-wrap:anywhere] ${
            dense ? "text-sm" : "text-base"
          }`}
        >
          {item.text}
        </p>
        {item.attachments && item.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
            {item.attachments.map((a) => (
              <span
                key={a.label}
                className="flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 font-mono text-xs text-fg-muted"
              >
                <Glyph name="fileText" size={12} />
                {a.label}
                {a.lines && <span className="text-fg-subtle">{a.lines}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The per-turn footer under a settled reply (the app's TaskStatsLine, `task-stats-line.tsx`).
 * The reply's own time leads — the numbers annotate it — and the five chips are the app's five,
 * in its order. The cache composition is not broken down here and the tool count is not shown:
 * both belong to the Trace page's turn card.
 */
export function StatsLine({ atIso, stats, f }: { atIso: string; stats: TurnStats; f: Fixtures }) {
  const t = f.copy.traces;
  return (
    <div className="-mt-1 mb-3 flex h-5 items-center gap-3 whitespace-nowrap text-fg-subtle">
      <span>{messageTime(atIso, f.lang)}</span>
      <StatChip glyph="arrowUpLine" value={tokens(stats.inputTokens)} title={t.inputTokens} />
      <StatChip glyph="arrowDownLine" value={tokens(stats.outputTokens)} title={t.outputTokens} />
      <StatChip glyph="gauge" value={`${stats.outputTps} tok/s`} title={t.outputTps} />
      <StatChip glyph="cost" value={usd(stats.costUsd)} title={t.cost} />
      <StatChip glyph="clock" value={duration(stats.elapsedMs)} title={t.elapsed} />
      <span className="flex items-center gap-1">
        <IconButton icon="copy" size="sm" label={f.copy.chat.copy} />
        <IconButton icon="fork" size="sm" label={f.copy.chat.fork} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Work group
// ---------------------------------------------------------------------------

const ROW = "flex w-full items-center gap-2 bg-surface px-3 py-1.5 text-left";
const CHEVRON = (open: boolean) => (
  <Glyph name={open ? "chevronDown" : "chevronRight"} size={14} className="text-fg-subtle" />
);

function ThinkingRow({ item, open, f }: { item: ThinkingItem; open: boolean; f: Fixtures }) {
  return (
    <div>
      <div className={ROW}>
        <StatusMark state={item.state} f={f} />
        <span className="shrink-0 text-xs text-fg-muted">{f.copy.chat.thinking}</span>
        <span className="shrink-0 font-mono text-xs text-fg-muted">
          {item.durationMs !== undefined
            ? duration(item.durationMs)
            : liveDuration(item.elapsedMs ?? 0)}
        </span>
        <span className="min-w-0 flex-1" />
        {CHEVRON(open)}
      </div>
      {open && (
        <div className="border-t border-line-muted px-3 py-2 text-fg-muted">
          <Markdown text={item.text} size="sm" streaming={item.state === "running"} />
        </div>
      )}
    </div>
  );
}

/** A unified diff: hunk header, then old/new gutters and the changed lines on tinted rows. */
export function DiffViewer({ diff }: { diff: FileDiff }) {
  return (
    <div className="ui-frame font-mono text-xs leading-5">
      <div
        data-slot="head"
        className="flex items-center justify-between gap-2 bg-surface-muted px-3 py-1 text-fg-muted"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Glyph name="file" size={12} />
          <span className="min-w-0 truncate">{diff.path}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-tone-success-fg">+{diff.added}</span>
          <span className="text-tone-danger-fg">−{diff.removed}</span>
        </span>
      </div>
      <div data-slot="body" className="overflow-x-auto">
        {diff.hunks.map((h) => (
          <div key={h.header}>
            <div className="bg-[var(--ui-diff-hunk-bg)] px-3 text-fg-subtle">{h.header}</div>
            {h.lines.map((l, i) => (
              <div
                key={i}
                className={`flex whitespace-pre ${
                  l.kind === "add"
                    ? "bg-[var(--ui-diff-add-bg)]"
                    : l.kind === "del"
                      ? "bg-[var(--ui-diff-del-bg)]"
                      : ""
                }`}
              >
                <span className="w-9 shrink-0 select-none pr-1.5 text-right text-[var(--ui-code-gutter)]">
                  {l.oldNo ?? ""}
                </span>
                <span className="w-9 shrink-0 select-none pr-1.5 text-right text-[var(--ui-code-gutter)]">
                  {l.newNo ?? ""}
                </span>
                <span
                  className={`w-4 shrink-0 select-none text-center ${
                    l.kind === "add"
                      ? "text-tone-success-fg"
                      : l.kind === "del"
                        ? "text-tone-danger-fg"
                        : "text-fg-subtle"
                  }`}
                >
                  {l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}
                </span>
                <span className="pr-3 text-fg">{l.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The child Session a `run_subagent` call started: a row under the call, not a card. A hairline
 * separates it from the output above; a second bordered box inside the work group would be one
 * surface too many (§1.3 row 16).
 */
function SubagentRow({ item, f }: { item: ToolCallItem; f: Fixtures }) {
  const sub = item.subagent!;
  return (
    <div className="flex w-full items-center gap-2 border-t border-line-muted bg-surface px-3 py-2">
      <AgentTile id={sub.agentId} name={sub.agentName} size={16} />
      <span className="min-w-0 truncate text-xs font-(--ui-weight-medium) text-fg">
        {sub.agentName}
      </span>
      <span className="shrink-0 font-mono text-xs text-fg-subtle">{sub.shortId}</span>
      {sub.running && <Spinner size="xs" label={f.copy.chat.runStates.running} />}
      {sub.pendingApproval && <Dot tone="attention" />}
      <span className="min-w-0 flex-1" />
    </div>
  );
}

/**
 * The pending-approval block: the one genuine ask in a view, so it keeps its amber fill — but the
 * rule above it is the neutral line, because a tint and a line of the same hue is the one-hue box
 * (§1.3 row 19). The alias is mono text; it needs no chip of its own.
 */
function ApprovalBlock({ item, f }: { item: ToolCallItem; f: Fixtures }) {
  // The waiting call is an `exec_command`, and the fixture writes its arguments with `json()`.
  const { cmd } = JSON.parse(item.argumentsJson) as { cmd: string };
  const preview = `$ ${cmd.replace(/\s+/g, " ")}`;
  return (
    <div className="border-t border-line bg-tone-attention-bg px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="shrink-0 font-mono text-xs font-(--ui-weight-strong) text-fg">
          {item.alias}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">{preview}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-control border border-accent bg-accent px-2.5 py-1 text-xs font-(--ui-weight-medium) text-accent-fg">
          {f.copy.chat.approve}
        </span>
        <span className="rounded-control border border-line-emphasis bg-surface px-2.5 py-1 text-xs font-(--ui-weight-medium) text-fg">
          {f.copy.chat.deny}
        </span>
      </div>
    </div>
  );
}

function ToolRow({ item, open, f }: { item: ToolCallItem; open: boolean; f: Fixtures }) {
  const timing =
    item.durationMs !== undefined ? duration(item.durationMs) : liveDuration(item.elapsedMs ?? 0);
  return (
    <div>
      <div className={ROW}>
        <StatusMark state={item.state} f={f} />
        <span className="shrink-0 font-mono text-xs font-(--ui-weight-strong) text-fg">
          {item.alias}
        </span>
        {item.subtitle && (
          <span className="min-w-0 shrink truncate text-xs text-fg-muted">{item.subtitle}</span>
        )}
        <span className="shrink-0 font-mono text-xs text-fg-muted">{timing}</span>
        <span className="min-w-0 flex-1" />
        {item.background && (
          <span className="shrink-0 font-mono text-xs text-tone-neutral-fg">
            {f.copy.chat.backgroundCall}
          </span>
        )}
        {CHEVRON(open)}
      </div>
      {item.state === "waiting" && <ApprovalBlock item={item} f={f} />}
      {open && (
        <div>
          {item.diff ? (
            <div className="border-t border-line-muted">
              <DiffViewer diff={item.diff} />
            </div>
          ) : (
            <>
              <pre className="whitespace-pre-wrap break-all border-t border-line-muted bg-surface-inset px-3 py-2 font-mono text-xs text-fg-muted">
                {item.argumentsJson}
              </pre>
              {item.output !== undefined && (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-line-muted bg-surface px-3 py-2 font-mono text-xs leading-5 text-fg-muted">
                  {item.output}
                  {item.outputStreaming && <StreamingCaret />}
                </pre>
              )}
            </>
          )}
        </div>
      )}
      {item.subagent && <SubagentRow item={item} f={f} />}
    </div>
  );
}

type WorkItem = ThinkingItem | ToolCallItem;

function WorkGroup({
  items,
  running,
  expansion,
  f,
}: {
  items: WorkItem[];
  running: boolean;
  expansion: Expansion;
  f: Fixtures;
}) {
  const open = running || (expansion.groups?.has(items[0]!.id) ?? false);
  const steps = items.filter((i) => i.kind === "tool_call").length;
  const settled = items.reduce((ms, i) => ms + (i.durationMs ?? i.elapsedMs ?? 0), 0);
  return (
    <div className="ui-frame my-2 overflow-clip rounded-md border border-line bg-surface">
      <div
        data-slot="head"
        className="flex w-full items-center justify-between gap-2 bg-surface-muted px-3 py-2"
      >
        <span className="flex min-w-0 items-center gap-2">
          <StatusMark state={running ? "running" : "done"} f={f} />
          <span
            className={`shrink-0 text-xs font-(--ui-weight-strong) ${
              running ? "text-tone-success-fg" : "text-fg-muted"
            }`}
          >
            {stateWord(running ? "running" : "done", f)}
          </span>
          {steps > 0 && (
            <span className="shrink-0 font-mono text-xs text-fg-subtle">
              {f.copy.chat.steps(steps)}
            </span>
          )}
          <span className="shrink-0 font-mono text-xs text-fg-subtle">
            {running ? liveDuration(settled) : duration(settled)}
          </span>
        </span>
        {CHEVRON(open)}
      </div>
      {open && (
        <div data-slot="body" className="divide-y divide-line-muted border-t border-line">
          {items.map((item) =>
            item.kind === "thinking" ? (
              <ThinkingRow
                key={item.id}
                item={item}
                open={expansion.rows?.has(item.id) ?? false}
                f={f}
              />
            ) : (
              <ToolRow
                key={item.id}
                item={item}
                open={expansion.rows?.has(item.id) ?? false}
                f={f}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

type Segment = { kind: "item"; item: ChatItem } | { kind: "work"; items: WorkItem[] };

function segments(items: readonly ChatItem[]): Segment[] {
  const out: Segment[] = [];
  for (const item of items) {
    if (item.kind === "thinking" || item.kind === "tool_call") {
      const last = out[out.length - 1];
      if (last?.kind === "work") last.items.push(item);
      else out.push({ kind: "work", items: [item] });
    } else {
      out.push({ kind: "item", item });
    }
  }
  return out;
}

/**
 * One turn of the transcript. `from` drops the items before an id — a screen scrolled past the
 * start of a long turn shows only its tail.
 */
export function Turn({
  turn,
  f,
  expansion = {},
  from,
  dense = false,
}: {
  turn: ChatTurn;
  f: Fixtures;
  expansion?: Expansion;
  from?: string;
  /** The dock's narrower column: prose one step smaller. */
  dense?: boolean;
}) {
  // `from` names an item of this turn. An id that is not in it fails the render rather than
  // quietly drawing the whole turn — the screens' `find(…)!` idiom, one rung down.
  const start = from === undefined ? 0 : turn.items.findIndex((i) => i.id === from);
  if (start < 0) throw new Error(`Turn: no item "${from}" to start from`);
  const segs = segments(turn.items.slice(start));
  const reply = turn.items.filter((i) => i.kind === "text").at(-1);
  return (
    <>
      {segs.map((seg, i) => {
        const last = i === segs.length - 1;
        if (seg.kind === "work") {
          const running = turn.running && last;
          return (
            <WorkGroup
              key={seg.items[0]!.id}
              items={seg.items}
              running={running}
              expansion={expansion}
              f={f}
            />
          );
        }
        const item = seg.item;
        if (item.kind === "user") return <UserBubble key={item.id} item={item} dense={dense} />;
        if (item.kind === "text") {
          return (
            <div key={item.id} className="my-3">
              <Markdown
                text={item.markdown}
                streaming={item.streaming}
                size={dense ? "sm" : "base"}
              />
            </div>
          );
        }
        return null;
      })}
      {turn.stats && <StatsLine atIso={reply!.atIso} stats={turn.stats} f={f} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Composer (W6: ComposerCard, ChipRow, ToolbarTrigger, SendButton)
// ---------------------------------------------------------------------------

/**
 * The 14 px context gauge: a ring filled to the share of the compaction threshold in use — the
 * basis the app fills against (`features/chat/context-gauge.tsx`), which turns amber past 80% and
 * red past 95%. This mock stands at 68%, so the ring keeps its resting ink.
 */
function ContextRing({ used, basis }: { used: number; basis: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const share = Math.min(1, used / basis);
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--ui-line)" strokeWidth="2" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke="var(--ui-fg-muted)"
        strokeWidth="2"
        strokeDasharray={`${Math.max(share * c, 1)} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

/**
 * The floating card the composer sits in: the one place in the transcript that glass belongs,
 * because the conversation scrolls underneath it (`.ui-glass`, Appendix B).
 */
function ComposerCard({ children }: { children: ReactNode }) {
  return (
    <div className="ui-glass @container rounded-lg border border-line-emphasis bg-surface px-2.5 pb-2 pt-2">
      {children}
    </div>
  );
}

export function Composer({ f, compact = false }: { f: Fixtures; compact?: boolean }) {
  const s = f.session;
  const c = f.copy.chat;
  const model = f.models.find((m) => m.modelId === s.model.modelId)!;
  return (
    <div className="shrink-0 border-t border-line px-3 py-3">
      <div className="mx-auto max-w-3xl">
        <ComposerCard>
          {!compact && s.composer.chips.length > 0 && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1">
              {s.composer.chips.map((chip) => (
                <span
                  key={chip.label}
                  className={`flex max-w-48 items-center gap-1 rounded-md py-0.5 pl-2 pr-1 font-mono text-xs text-fg ${NEUTRAL_FILL}`}
                >
                  <Glyph
                    name={chip.kind === "skill" ? "book" : "fileText"}
                    size={12}
                    className="text-fg-muted"
                  />
                  <span className="truncate">{chip.label}</span>
                  {chip.lines && <span className="shrink-0 text-fg-subtle">{chip.lines}</span>}
                  <Glyph name="cross" size={11} className="ml-0.5 text-fg-subtle" />
                </span>
              ))}
            </div>
          )}
          <p
            className={`px-1 py-0.5 text-base leading-6 ${
              s.composer.draft ? "text-fg" : "text-fg-subtle"
            } ${compact ? "min-h-6" : "min-h-[3.75rem]"}`}
          >
            {s.composer.draft || c.inputPlaceholder}
            {s.composer.draft && (
              <span aria-hidden className="ml-px inline-block h-5 w-px translate-y-1 bg-fg" />
            )}
          </p>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <div className="flex shrink-0 items-center gap-1">
              <IconButton icon="plus" label={c.attach} />
              <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-fg-muted">
                <Glyph name="shield" size={14} />
                {c.approvalModes[s.composer.approvalMode]}
                <Glyph name="chevronDown" size={12} className="text-fg-subtle" />
              </span>
              <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-fg-muted">
                <Glyph name="book" size={14} />
                {c.skills}
                <Glyph name="chevronDown" size={12} className="text-fg-subtle" />
              </span>
              {!compact && (
                <span className="hidden min-w-0 truncate px-1 text-fg-subtle @2xl:block">
                  {c.slashHint}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1" />
            <div className="flex min-w-0 items-center gap-2">
              <ContextRing used={s.context.tokens} basis={s.context.threshold} />
              <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-fg-muted">
                <Glyph name="sparkle" size={13} />
                {c.thinkingLevels[s.composer.thinkingLevel]}
                <Glyph name="chevronDown" size={12} className="text-fg-subtle" />
              </span>
              <span className="flex h-8 min-w-0 items-center gap-1.5 rounded-control px-1 text-fg-muted">
                <AgentTile id={s.model.provider} name={model.providerLabel} size={16} />
                <span className="min-w-0 truncate">{model.displayName}</span>
              </span>
              {/* Stop is a control, not a status: a solid fill, never danger ink on a danger tint. */}
              <span
                role="button"
                aria-label={c.stop}
                title={c.stop}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-tone-danger-emphasis text-tone-danger-emphasis-fg"
              >
                <span className="h-2.5 w-2.5 rounded-xs bg-current" />
              </span>
            </div>
          </div>
        </ComposerCard>
      </div>
    </div>
  );
}
