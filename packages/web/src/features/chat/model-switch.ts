/**
 * In-conversation model switch (the active Session's toolbar model picker): the decisions the
 * chat page makes, kept pure so they are testable without a DOM.
 *
 * The switch is not the `/model` handoff. `/model` opens a NEW conversation on another model
 * and leaves this one as it is; this picker keeps the conversation and moves it onto the
 * picked model. That compacts on the current model first (`POST …/switch-model` answers 202 and
 * streams an ordinary compaction row, then the new context's `session_meta`), except for a
 * Session that never ran, which has no context to compact and switches inside the request (200
 * with the updated Session). Only that `session_meta` says the Session moved: the stream model
 * turns it into a model-change marker, and the page refetches the Session row when the row
 * names another model (see sessionRowStale). A compaction that fails streams no meta, and the
 * Session stays on the model it was on.
 */
import type {
  ModelRefDto,
  SessionInfo,
  SessionResponse,
  SessionStatus,
  TaskCreateResponse,
} from "@prismshadow/penguin-server/api";
import { sameModelRef } from "../models/model-grouping";
import type { ThinkingSwitchItem } from "./thinking-level";

/**
 * Whether the picker is disabled: a switch compacts, and the server neither starts nor queues a
 * compaction while a Task runs or another compaction is under way.
 */
export function sessionModelPickerDisabled(status: SessionStatus): boolean {
  return status === "running" || status === "compacting";
}

/**
 * What the switch will do to the context, read off the loaded transcript — the dialog and the
 * toast promise exactly that and no more:
 * - `"compact"` — there is conversation since the last compaction: the switch compacts it on
 *   the current model first, and the stream carries that compaction;
 * - `"empty"` — nothing at all yet: the switch is immediate (the server answers 200);
 * - `"compacted"` — the transcript ends in a completed compaction with nothing said since: the
 *   server runs no compaction and streams no summarize pair, the conversation continues on the
 *   target from the summary already held (a switch right after a switch closes the untouched
 *   context with a discard pair — housekeeping, not a compaction of anything).
 */
export type SwitchContextShape = "compact" | "empty" | "compacted";

/**
 * Walks the trailing run of compaction rows and model-change markers the way the thinking
 * switch's guard does (see `prefixCacheAtRisk`): a completed compaction anywhere in that run
 * means the context in effect is the summary; a failed one after it changed nothing.
 */
export function switchContextShape(items: ReadonlyArray<ThinkingSwitchItem>): SwitchContextShape {
  if (items.length === 0) return "empty";
  let last = items.length - 1;
  let compacted = false;
  while (last >= 0 && ["compaction", "model_change"].includes(items[last]!.kind)) {
    const c = items[last]!;
    if (!c.running && c.status === "completed") compacted = true;
    last--;
  }
  return compacted ? "compacted" : "compact";
}

/**
 * What a pick asks of the page:
 * - `"none"` — the current model (nothing to switch), or a pick that raced a Task starting
 *   (the picker is disabled then, and the server would refuse it anyway);
 * - `"confirm"` — open the confirm dialog, worded for `shape` (see {@link SwitchContextShape}).
 */
export type SessionModelPick = { act: "none" } | { act: "confirm"; shape: SwitchContextShape };

export function sessionModelPick(opts: {
  current: ModelRefDto | null;
  picked: ModelRefDto;
  status: SessionStatus;
  /** The loaded transcript's shape (the live tail behind any backfilled window), see `switchContextShape`. */
  shape: SwitchContextShape;
}): SessionModelPick {
  if (sameModelRef(opts.picked, opts.current)) return { act: "none" };
  if (sessionModelPickerDisabled(opts.status)) return { act: "none" };
  return { act: "confirm", shape: opts.shape };
}

/**
 * The two success shapes of `POST …/switch-model`, told apart by the body (the client does not
 * expose the status code): a {@link SessionResponse} carries `session` — the Session never ran
 * and already switched — while a {@link TaskCreateResponse} carries the (possibly self-healed)
 * `sessionId` of a switch that is now streaming.
 */
export type ModelSwitchOutcome =
  { kind: "applied"; session: SessionInfo } | { kind: "streaming"; sessionId: string };

export function modelSwitchOutcome(res: TaskCreateResponse | SessionResponse): ModelSwitchOutcome {
  if ("session" in res) return { kind: "applied", session: res.session };
  return { kind: "streaming", sessionId: res.sessionId };
}

/**
 * Whether the Session row on hand is stale: the running context's `session_meta` (the stream
 * model's `contextModel`) names another model than the row does — a switch completed, on this
 * tab or another one watching the Session, or the row was held from before a switch. The page
 * refetches the row once the Session is idle. False while no meta has been seen: a history
 * window that starts after the context's meta derives nothing, and the row stands.
 */
export function sessionRowStale(
  contextModel: ModelRefDto | null,
  current: ModelRefDto | null,
): boolean {
  return contextModel !== null && !sameModelRef(contextModel, current);
}
