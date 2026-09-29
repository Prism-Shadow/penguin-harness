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
import { contextReading, duration, liveDuration, tokens, usd } from "./format";
import { Glyph } from "./glyph";
import type { GlyphName } from "./glyph";
import { Markdown, StreamingCaret } from "./markdown";
import {
  AgentTile,
  DisclosureBody,
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

export function UserBubble({
  item,
  dense,
}: {
  item: Pick<Extract<ChatItem, { kind: "user" }>, "text" | "attachments">;
  dense: boolean;
}) {
  return (
    <div className={`${dense ? "my-2" : "my-4"} flex flex-col items-end`}>
      <div
        className={`max-w-[75%] rounded-lg ${NEUTRAL_FILL} ${dense ? "px-3 py-2" : "px-4 py-2.5"}`}
      >
        <p
          className={`whitespace-pre-wrap font-sans leading-relaxed text-fg [overflow-wrap:anywhere] ${
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
 * The per-turn footer under a settled reply (the app's TaskStatsLine), in the app's order: input,
 * output, output speed, cost, elapsed, then copy and fork. The app shows it on hover at desktop
 * width; a still shows it, since a still has no pointer.
 */
export function StatsLine({ stats, f }: { stats: TurnStats; f: Fixtures }) {
  const t = f.copy.traces;
  return (
    <div className="-mt-2 mb-3 flex h-5 items-center gap-3 whitespace-nowrap text-xs text-fg-subtle">
      <StatChip
        mono={false}
        glyph="arrowUpLine"
        value={tokens(stats.inputTokens)}
        title={t.inputTokens}
      />
      <StatChip
        mono={false}
        glyph="arrowDownLine"
        value={tokens(stats.outputTokens)}
        title={t.outputTokens}
      />
      <StatChip mono={false} glyph="gauge" value={`${stats.outputTps} tok/s`} title={t.outputTps} />
      <StatChip mono={false} glyph="cost" value={usd(stats.costUsd)} title={`${t.cost}（USD）`} />
      <StatChip mono={false} glyph="clock" value={duration(stats.elapsedMs)} title={t.elapsed} />
      <span className="flex items-center gap-1">
        <IconButton icon="copy" size="sm" label={f.copy.chat.copyReply} />
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
      {sub.pendingApproval && <Dot className="bg-tone-attention-emphasis" />}
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
  let preview = item.argumentsJson;
  try {
    const args = JSON.parse(item.argumentsJson) as { cmd?: string };
    if (args.cmd) preview = `$ ${args.cmd.replace(/\s+/g, " ")}`;
  } catch {
    // Arguments stay as written.
  }
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

export type WorkItem = ThinkingItem | ToolCallItem;

export function WorkGroup({
  items,
  running,
  expansion,
  f,
  live,
}: {
  items: WorkItem[];
  running: boolean;
  expansion: Expansion;
  f: Fixtures;
  /**
   * A live scene's hold on the body: it opens and folds by height rather than mounting, and each
   * row arrives with `data-reveal`. Absent, the group is open while it runs or when expanded.
   */
  live?: { open: boolean };
}) {
  const open = live ? live.open : running || (expansion.groups?.has(items[0]!.id) ?? false);
  const row = (item: WorkItem) =>
    item.kind === "thinking" ? (
      <ThinkingRow key={item.id} item={item} open={expansion.rows?.has(item.id) ?? false} f={f} />
    ) : (
      <ToolRow key={item.id} item={item} open={expansion.rows?.has(item.id) ?? false} f={f} />
    );
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
      {/*
        The rows hang off the group's head, so the body is a `ui-tree`: Console draws the
        connector rules and drops the box, Frost indents against a soft rule, Primer keeps the
        bordered body. Each row is one level down and the last one closes it.
      */}
      {live && (
        <DisclosureBody open={live.open}>
          <div data-slot="body" className="ui-tree divide-y divide-line-muted border-t border-line">
            {items.map((item, i) => (
              <div
                key={item.id}
                data-reveal
                data-depth={1}
                data-last={i === items.length - 1 ? "true" : undefined}
              >
                {row(item)}
              </div>
            ))}
          </div>
        </DisclosureBody>
      )}
      {!live && open && (
        <div data-slot="body" className="ui-tree divide-y divide-line-muted border-t border-line">
          {items.map((item, i) => (
            <div
              key={item.id}
              data-depth={1}
              data-last={i === items.length - 1 ? "true" : undefined}
            >
              {row(item)}
            </div>
          ))}
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
  const start = from
    ? Math.max(
        0,
        turn.items.findIndex((i) => i.id === from),
      )
    : 0;
  const segs = segments(turn.items.slice(start));
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
      {turn.stats && <StatsLine stats={turn.stats} f={f} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Composer (W6: ComposerCard, ChipRow, ToolbarTrigger, SendButton)
// ---------------------------------------------------------------------------

/** Each approval mode's glyph: what the mode lets through, at a glance. */
const APPROVAL_GLYPH: Record<Fixtures["session"]["composer"]["approvalMode"], GlyphName> = {
  "allow-all": "alert",
  "read-only": "eye",
  "always-ask": "help",
  "deny-all": "ban",
};

/**
 * The context gauge: a 14 px ring filled to the share of the model's window in use, in a
 * button-sized box, its reading in the tooltip.
 */
function ContextGauge({ f }: { f: Fixtures }) {
  const { tokens: used, window } = f.session.context;
  const r = 5;
  const c = 2 * Math.PI * r;
  const share = Math.min(1, used / window);
  const reading = contextReading(f.copy.chat.contextUsage, used, window);
  return (
    <span
      role="img"
      title={reading}
      aria-label={reading}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-subtle"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2"
        />
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(share * c, 1)} ${c}`}
          transform="rotate(-90 7 7)"
        />
      </svg>
    </span>
  );
}

/**
 * A composer picker's trigger: its glyph, its current choice — hidden while the card is narrow —
 * and a small chevron, all in the trigger's own muted ink.
 */
export function ToolbarTrigger({
  glyph,
  lead,
  label,
  name,
  count,
  chevron = true,
}: {
  glyph?: GlyphName;
  /** A leading mark drawn by the caller instead of a glyph: the model's provider tile. */
  lead?: ReactNode;
  label: string;
  /** The picker's accessible name, when the label is its current choice. */
  name?: string;
  /** How many are picked, where the picker takes several (Skills). */
  count?: number;
  chevron?: boolean;
}) {
  return (
    <span
      role="button"
      aria-label={name ?? label}
      title={name ? `${name}：${label}` : label}
      className="flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-fg-muted"
    >
      {lead ?? (glyph && <Glyph name={glyph} size={13} />)}
      <span className="hidden min-w-0 truncate @md:block">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={`rounded-[var(--ui-radius-pill)] px-1.5 py-px font-mono text-xs font-(--ui-weight-strong) tabular-nums text-fg ${NEUTRAL_FILL}`}
        >
          {count}
        </span>
      )}
      {chevron && <Glyph name="chevronDown" size={10} />}
    </span>
  );
}

/**
 * The attachment chips over the draft: the Skills first, then the file references. Given
 * `onRemove`, each chip's cross is a real button that drops it, named by `removeLabel`.
 */
export function ComposerChips({
  chips,
  onRemove,
  removeLabel,
}: {
  chips: readonly Fixtures["session"]["composer"]["chips"][number][];
  onRemove?: (label: string) => void;
  removeLabel?: string;
}) {
  if (chips.length === 0) return null;
  const ordered = [
    ...chips.filter((chip) => chip.kind === "skill"),
    ...chips.filter((chip) => chip.kind !== "skill"),
  ];
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1">
      {ordered.map((chip) => (
        <span
          key={chip.label}
          className={`flex max-w-48 items-center gap-1 rounded-md py-0.5 pl-2 pr-1 font-mono text-xs text-fg ${NEUTRAL_FILL}`}
        >
          <Glyph
            name={chip.kind === "skill" ? "book" : "fileText"}
            size={13}
            className="text-fg-muted"
          />
          <span className="truncate">{chip.label}</span>
          {chip.lines && <span className="shrink-0">{chip.lines}</span>}
          {onRemove === undefined ? (
            <span className="rounded-sm p-px text-fg-subtle">
              <Glyph name="cross" size={11} />
            </span>
          ) : (
            <button
              type="button"
              aria-label={removeLabel ? `${removeLabel} ${chip.label}` : chip.label}
              title={removeLabel}
              onClick={() => onRemove(chip.label)}
              className="rounded-sm p-px text-fg-subtle transition-colors duration-150 hover:text-fg"
            >
              <Glyph name="cross" size={11} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * The composer's control row, left to right as the app lays it out: `+`, the approval mode, the
 * Skills picker with its count, the slash hint; then the context gauge, the thinking level, the
 * model, and the send button the caller draws. In a Session the model is fixed, so its trigger
 * has no chevron and no gauge is shown until a Session exists (`session`).
 */
export function ComposerToolbar({
  f,
  send,
  session = true,
  skills = 0,
  modelTrigger,
  onPlus,
}: {
  f: Fixtures;
  send: ReactNode;
  session?: boolean;
  /** Skills picked for the next message. */
  skills?: number;
  /** A caller's own model trigger, to hang a picker off it. */
  modelTrigger?: ReactNode;
  /** Makes `+` a real button: what it attaches is the caller's to decide. */
  onPlus?: () => void;
}) {
  const s = f.session;
  const c = f.copy.chat;
  const model = f.models.find((m) => m.modelId === s.model.modelId);
  return (
    <div className="mt-1 flex items-center justify-between gap-2 text-xs">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {onPlus === undefined ? (
          <span
            role="button"
            aria-label={c.plusMenu}
            title={c.plusMenu}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted"
          >
            <Glyph name="plus" size={15} />
          </span>
        ) : (
          <button
            type="button"
            aria-label={c.plusMenu}
            title={c.plusMenu}
            onClick={onPlus}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:text-fg"
          >
            <Glyph name="plus" size={15} />
          </button>
        )}
        <ToolbarTrigger
          glyph={APPROVAL_GLYPH[s.composer.approvalMode]}
          label={c.approvalModes[s.composer.approvalMode]}
          name={c.approvalMode}
        />
        <ToolbarTrigger glyph="book" label={c.skills} count={skills} />
        <span title={c.slashHint} className="hidden min-w-0 truncate text-fg-subtle @lg:block">
          {c.slashHint}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {session && <ContextGauge f={f} />}
        <ToolbarTrigger
          glyph="sparkle"
          label={c.thinkingLevels[s.composer.thinkingLevel]}
          name={c.thinkingLevel}
        />
        {modelTrigger ?? (
          <ToolbarTrigger
            lead={<AgentTile id={s.model.provider} name={model?.providerLabel ?? "?"} size={16} />}
            label={model?.displayName ?? s.model.modelId}
            name={`${c.model} ${s.model.modelId}`}
            chevron={!session}
          />
        )}
        {send}
      </div>
    </div>
  );
}

/**
 * The send button: the accent's solid fill once there is something to send, a quiet neutral well
 * while the draft is empty. While a Task runs, sending steers it, and the button says so.
 */
export function SendButton({
  f,
  ready,
  steer = false,
  onClick,
}: {
  f: Fixtures;
  ready: boolean;
  steer?: boolean;
  /** Makes it a real button; a press while it is not ready does nothing. */
  onClick?: () => void;
}) {
  const label = steer ? f.copy.chat.steerSend : f.copy.chat.send;
  const className = `flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ${
    ready ? "bg-accent text-accent-fg" : `${NEUTRAL_FILL} text-fg-subtle`
  }`;
  return onClick === undefined ? (
    <span
      role="button"
      aria-label={label}
      title={label}
      aria-disabled={ready ? undefined : true}
      className={className}
    >
      <Glyph name="arrowUp" size={17} />
    </span>
  ) : (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={ready ? undefined : true}
      onClick={() => {
        if (ready) onClick();
      }}
      className={className}
    >
      <Glyph name="arrowUp" size={17} />
    </button>
  );
}

/** Stop is a control, not a status: a solid fill, never danger ink on a danger tint. */
export function StopButton({ f, onClick }: { f: Fixtures; onClick?: () => void }) {
  const className =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-tone-danger-emphasis text-tone-danger-emphasis-fg";
  const mark = <span className="h-2.5 w-2.5 rounded-xs bg-current" />;
  return onClick === undefined ? (
    <span
      role="button"
      aria-label={f.copy.chat.stop}
      title={f.copy.chat.stop}
      className={className}
    >
      {mark}
    </span>
  ) : (
    <button
      type="button"
      aria-label={f.copy.chat.stop}
      title={f.copy.chat.stop}
      onClick={onClick}
      className={className}
    >
      {mark}
    </button>
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

/**
 * The chat's composer on a running Task: the chips, the draft behind its caret, and the control
 * row. With a draft written, the button sends it to the running agent; with none, it stops the
 * Task.
 */
export function Composer({ f, compact = false }: { f: Fixtures; compact?: boolean }) {
  const s = f.session;
  const c = f.copy.chat;
  const chips = compact ? [] : s.composer.chips;
  const draft = s.composer.draft;
  return (
    <div className="shrink-0 border-t border-line px-3 py-3">
      <div className="mx-auto max-w-3xl">
        <ComposerCard>
          <ComposerChips chips={chips} />
          <p
            className={`px-1 py-0.5 font-sans text-base leading-6 ${
              draft ? "text-fg" : "text-fg-subtle"
            } ${compact ? "min-h-6" : "min-h-[3.75rem]"}`}
          >
            {draft || c.inputPlaceholder}
            {draft && (
              <span aria-hidden className="ml-px inline-block h-5 w-px translate-y-1 bg-fg" />
            )}
          </p>
          <ComposerToolbar
            f={f}
            skills={chips.filter((chip) => chip.kind === "skill").length}
            send={
              s.running && !draft ? (
                <StopButton f={f} />
              ) : (
                <SendButton f={f} ready={draft !== ""} steer={s.running} />
              )
            }
          />
        </ComposerCard>
      </div>
    </div>
  );
}
