/**
 * Pure logic for the conversation-time thinking-level pickers (chat draft + active session).
 *
 * Two variants share these levels and labels, and both list only concrete levels — there is
 * no "follow config" row anywhere:
 * - Draft view: backed by the **Agent settings** (`system_config.model.thinking_level`) —
 *   shows the selected Agent's current level and writes a picked level straight through to
 *   the Agent config, so the session created on first send runs with it and it becomes the
 *   Agent's new default (switch-becomes-default).
 * - Active session: the level is a **per-turn override**. The picker's displayed value
 *   initializes to the Agent config's level and auto-follows it while the user hasn't
 *   picked (internally the "" state remains as "untouched": tasks then omit the level, so
 *   the server/core fallback applies and config edits keep taking effect); an explicit pick
 *   sticks for the session and rides on every subsequent task as `thinkingLevel`, never
 *   writing through to the Agent config.
 * Per review: the menus list the levels with short names only (no descriptions, no
 * "default" row) under a title bar naming the control — and they do **not** offer "none"
 * (many models cannot disable thinking): "none" stays a valid stored/wire value, so a
 * legacy config or trace that carries it still displays via the label table below.
 */

/** All stored/wire levels, for display lookup (mirrors core's ThinkingLevelName). */
export const THINKING_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * The levels the picker offers, in menu order: "none" is deliberately excluded (many models
 * don't support disabling thinking) — it can still be displayed (a stored legacy value) but
 * never picked. "max" carries no such caveat: every AgentHub client maps it onto the deepest
 * effort its vendor accepts and degrades silently where there is no such tier, so it is
 * offered like any other tier.
 */
export const SELECTABLE_THINKING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

/**
 * Effective thinking level for the draft picker's DISPLAY — the SAME chain core resolves
 * when a Session is created (core/src/agent.ts `configuredThinkingLevel`, the single rule):
 * the Agent's explicit `model.thinking_level` > the Project's `default_chat.thinking_level`
 * > the built-in "medium". Keep the two sites in sync. `agentLevel` is the raw agent-config
 * value ("" = no explicit override); `projectDefault` is `default_chat.thinking_level`
 * (undefined when the Project sets none). The picker shows this effective value; picking
 * still writes through to the AGENT config only — the project default is a fallback, never
 * overwritten by the picker.
 */
export function effectiveThinkingLevel(
  agentLevel: string,
  projectDefault: string | undefined,
): string {
  return agentLevel || (projectDefault ?? "medium");
}

/**
 * Short display label for a level from the localized name table (S.chat.thinkingLevelNames).
 * Covers every stored level including "none" (so a legacy value displays sanely instead
 * of being rewritten or hidden). Returns null for anything else — including "" (an Agent
 * without an explicit override) and session_meta's "default" — so callers can render a
 * placeholder on the trigger and hide the session read-only tag instead of showing a raw
 * internal value.
 */
export function thinkingLevelLabel(
  names: Readonly<Record<string, string>>,
  level: string | null | undefined,
): string | null {
  return level && (THINKING_LEVELS as readonly string[]).includes(level)
    ? (names[level] ?? level)
    : null;
}

/**
 * The level the ACTIVE-SESSION picker displays, and the one its sends carry.
 *
 * `pinned` is the Session's own stored level (`SessionInfo.thinkingLevel`, written by the
 * picker through PATCH — durable, so it survives a reload and a second tab); "" = never
 * pinned, and the picker then auto-follows `agentLevel`, the Agent config's level, exactly
 * as a brand-new session does. A pin wins from then on: later Agent-config edits no longer
 * move a session whose level the user chose explicitly.
 */
export function sessionThinkingLevel(pinned: string, agentLevel: string): string {
  return pinned || agentLevel;
}

/** One dropdown row of the agent-settings thinking-level menu (shape of OptionMenuChoice<string>). */
export interface ThinkingLevelOptionRow {
  value: string;
  /** Compact text on the trigger button. */
  triggerLabel: string;
  /** Panel row title. */
  label: string;
  /** Panel row description. */
  description: string;
}

/**
 * Assembles the agent-settings thinking-level dropdown rows from the dictionary's
 * [value, description] pairs, composing both review decisions:
 * - the "" (inherit) row is **filtered** — the menu offers only concrete tiers, the user
 *   picks explicitly; an unset value shows the OptionMenu's (default) placeholder and the
 *   reset link next to the menu rewinds a local pick back to it;
 * - `none` is no longer offered (many models cannot disable thinking) but stays a valid
 *   stored value: when the **persisted** config already carries it, a display-only row is
 *   appended — the trigger shows the real stored state and nothing is silently rewritten.
 *   Gating on the persisted value (not the local edit state) means a misclick onto another
 *   tier keeps the row until the change is actually saved, so the user can always click
 *   back to the value still stored on disk.
 */
export function thinkingLevelOptionsFor(
  options: ReadonlyArray<readonly [string, string]>,
  noneKeptDescription: string,
  storedLevel: string | undefined,
): ThinkingLevelOptionRow[] {
  const rows = options
    .filter(([value]) => value !== "")
    .map(([value, description]) => ({
      value,
      triggerLabel: value,
      label: value,
      description,
    }));
  if (storedLevel === "none") {
    rows.push({
      value: "none",
      triggerLabel: "none",
      label: "none",
      description: noneKeptDescription,
    });
  }
  return rows;
}

/**
 * Structural subset of a stream ChatItem that the mid-chat switch guard inspects: the
 * item kind plus the compaction items' outcome fields (`running`/`status` — string unions
 * on the real items, so `ChatItem[]` is assignable as-is).
 */
export interface ThinkingSwitchItem {
  kind: string;
  running?: boolean;
  status?: string;
}

/**
 * Whether the loaded transcript indicates provider-side history whose prefix cache a
 * thinking-level change would invalidate (issue #310): some providers implement the
 * thinking level as a prompt prefix injected at the very FRONT of the chat template, so
 * changing it mid-conversation re-bills the entire history as uncached input on the next
 * request.
 *
 * - An empty transcript (brand-new session, nothing sent yet) is free to switch.
 * - Items only need to be the LIVE TAIL window (stream model): a non-empty session always
 *   has a non-empty tail, and the trailing-compaction check below only looks at the tail.
 * - A transcript that ENDS in a settled successful compaction is also free to switch: the
 *   provider context was just rewritten to a short summary, so the user who followed the
 *   "compact first, then switch" advice is not warned a second time. Failed or still
 *   running trailing compactions don't count (the old context is still in effect), but a
 *   successful one anywhere in the trailing compaction run does (a failed retry after a
 *   success changed nothing).
 */
export function prefixCacheAtRisk(items: ReadonlyArray<ThinkingSwitchItem>): boolean {
  let last = items.length - 1;
  let compacted = false;
  while (last >= 0 && items[last]!.kind === "compaction") {
    const c = items[last]!;
    if (!c.running && c.status === "completed") compacted = true;
    last--;
  }
  // Nothing but (at most) compaction rows: no billable history to protect.
  if (last < 0) return false;
  return !compacted;
}

/**
 * Gate for the ACTIVE-SESSION picker's pick (the draft picker never confirms — there is no
 * session, so no provider cache yet): true = stage the pick behind the confirm dialog
 * instead of applying it.
 *
 * `currentLevel` is the level the picker currently DISPLAYS (the user's session pick, else
 * the Agent config's level; "" = unknown — config unset or still loading). Re-picking the
 * displayed level changes nothing provider-visible (it merely pins the level for the
 * session), so it never confirms; an unknown current level confirms whenever history is at
 * risk — a needless dialog costs one click, a silently invalidated prefix cache costs real
 * money.
 */
export function needsThinkingSwitchConfirm(
  items: ReadonlyArray<ThinkingSwitchItem>,
  currentLevel: string,
  nextLevel: string,
): boolean {
  if (currentLevel !== "" && nextLevel === currentLevel) return false;
  return prefixCacheAtRisk(items);
}

/**
 * Settled compaction attempts visible in the transcript, and how many of them completed.
 * Snapshotted when the user picks "compact, then switch" so the wait below can tell OUR
 * compaction's outcome from the ones that were already on record.
 */
export interface CompactionTally {
  settled: number;
  completed: number;
}

/** Counts settled (not still running) compaction items and the completed subset. */
export function compactionTally(items: ReadonlyArray<ThinkingSwitchItem>): CompactionTally {
  let settled = 0;
  let completed = 0;
  for (const item of items) {
    if (item.kind !== "compaction" || item.running === true) continue;
    settled++;
    if (item.status === "completed") completed++;
  }
  return { settled, completed };
}

/**
 * The dialog's "compact, then switch" choice, held while the compaction runs.
 *
 * `POST /compact` answers **202** — it only starts the compaction, whose outcome arrives
 * later over the stream — so the pick cannot be applied on the request promise. It is held
 * here until compactionSettledSince below reports the compaction over.
 *
 * The pick is applied either way once that happens (a failed compaction is reported, not
 * silently swallowed): holding it is about ORDER, not about a veto — a level applied while
 * the compaction is still running would ride on anything sent in between (a queued
 * follow-up auto-starts the moment the session goes idle) and invalidate the very cache
 * the compaction is there to shrink.
 */
export type StagedThinkingSwitch =
  /** The dialog is open on this pick. */
  | { phase: "ask"; level: string }
  /** A compaction was started; the pick lands when it settles (see compactionSettledSince). */
  | { phase: "compacting"; level: string; baseline: CompactionTally }
  /** The compaction never started (the server refused it): release the pick on the next pass. */
  | { phase: "settle"; level: string };

/**
 * Whether a compaction has finished since the tally was taken, and how it ended:
 * - `"completed"` — one completed: the provider context is now the short summary. Reported
 *   even if items were appended after it (a queued follow-up may have started), because the
 *   compaction the user asked for did happen.
 * - `"failed"` — one settled without completing (failed / aborted): the old context is still
 *   in effect, and the caller says so while still applying the pick.
 * - `"pending"` — nothing has settled yet, keep waiting.
 *
 * Counting rather than matching item ids keeps this correct across a stream reconnect
 * (history is rebuilt and ids restart); the worst case is a stalled `"pending"`.
 */
export function compactionSettledSince(
  items: ReadonlyArray<ThinkingSwitchItem>,
  baseline: CompactionTally,
): "pending" | "completed" | "failed" {
  const now = compactionTally(items);
  if (now.completed > baseline.completed) return "completed";
  if (now.settled > baseline.settled) return "failed";
  return "pending";
}

/**
 * What the page owes a staged switch right now — the whole decision, so the rule stays
 * testable instead of living in an effect:
 * - `"wait"` — the dialog is still open, or the compaction is still running.
 * - `"apply"` with a notice — release the pick. **The pick is applied whichever way the
 *   compaction ended**: a failed one only means the context was not rewritten (so the
 *   switch does cost cache hits), never that the user's choice is dropped.
 *   - `"compacted"`: the compaction completed, the cheap path worked out;
 *   - `"compaction-failed"`: it ended without completing — say so alongside the switch;
 *   - `"none"`: it never started (the server refused it and already said why).
 */
export type HeldThinkingSwitch =
  | { act: "wait" }
  | { act: "apply"; level: string; notice: "compacted" | "compaction-failed" | "none" };

export function heldThinkingSwitch(
  staged: StagedThinkingSwitch,
  items: ReadonlyArray<ThinkingSwitchItem>,
): HeldThinkingSwitch {
  if (staged.phase === "ask") return { act: "wait" };
  if (staged.phase === "settle") return { act: "apply", level: staged.level, notice: "none" };
  const outcome = compactionSettledSince(items, staged.baseline);
  if (outcome === "pending") return { act: "wait" };
  return {
    act: "apply",
    level: staged.level,
    notice: outcome === "completed" ? "compacted" : "compaction-failed",
  };
}
