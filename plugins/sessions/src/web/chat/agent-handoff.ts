/**
 * Agent handoff for the chat input area (pure logic, shared by chat-input.tsx /
 * chat-page.tsx and unit tests). A target agent is picked from the `/agent` command's picker
 * and pinned as a highlighted chip at the front of the input; the text body carries no marker
 * of its own. Nothing is sent at pick time — sending is what performs the handoff, and it
 * opens a NEW conversation for that agent instead of posting to the current Session.
 * - `filterAgents`: the picker's search box — filters candidates by agentId or display name.
 * - `stagedSendRoute`: where a send goes once a switch chip is staged (and when a staged
 *   `/model` fork must refuse to go at all).
 *
 * The origin **marker blocks** these flows produce and render — `[handoff_from]`,
 * `[scheduled_task]`, `[model_switch_from]` — are defined in core's marker module
 * (`@prismshadow/penguin-core/markers`) alongside every other message marker, and are
 * re-exported below under this feature's existing names.
 */
import { buildHandoffMessage, buildModelSwitchMessage } from "@prismshadow/penguin-core/markers";
import type { AgentSummary } from "@prismshadow/penguin-server/api";

export {
  parseBackgroundTaskDoneMessage,
  parseHandoffMessage,
  parseModelSwitchMessage,
  parseScheduledMessage,
} from "@prismshadow/penguin-core/markers";
export type {
  BackgroundTaskDone,
  HandoffOrigin,
  ModelSwitchOrigin,
  ScheduledOrigin,
} from "@prismshadow/penguin-core/markers";

/** First message of an `/agent` handoff conversation (core's `[handoff_from]` origin block). */
export const handoffMessage = buildHandoffMessage;
/** First message of a `/model` switch new conversation (core's `[model_switch_from]` origin block). */
export const modelSwitchMessage = buildModelSwitchMessage;

/**
 * Filters the `/agent` picker's candidates by its search box: a case-insensitive **substring**
 * match on the agentId or the display name — the same rule the model picker's search box uses,
 * so a word typed from memory ("creator") still finds the agent wherever it sits in the id. An
 * empty query returns every candidate.
 */
export function filterAgents(agents: AgentSummary[], query: string): AgentSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return agents;
  return agents.filter(
    (a) => a.agentId.toLowerCase().includes(q) || (a.name ?? "").toLowerCase().includes(q),
  );
}

/**
 * Where a send goes with the composer's switch chips staged:
 * - `post` — no chip is in play: the ordinary task / steer-fallback / follow-up post;
 * - `handoff` — a staged `/agent` target: opens a NEW chat for that agent, the current Session
 *   is not posted to at all;
 * - `model` — a staged `/model` target: forks this conversation onto that model;
 * - `blocked` — a staged `/model` target that must NOT go out yet (see below).
 */
export type StagedSendRoute = "post" | "handoff" | "model" | "blocked";

/**
 * The staged-switch send decision, pulled out of the composer so it can be reasoned about (and
 * unit-tested) on its own: staging is the whole point of `/agent` and `/model`, so *when* the
 * staged pick is allowed to fire is the behaviour worth pinning down.
 *
 * The one rule that isn't merely "which chip is staged": a `/model` fork branches a NEW Session
 * off **this** Session's Trace, so it may only run while this Session is idle. A run can start
 * from outside the composer at any time — a queued follow-up auto-sending, a scheduled Task
 * firing, another tab or the CLI posting — and forking then would point the new model at a
 * Trace that is still being appended to, while navigating the user away from a live run. Rather
 * than silently falling through to `post` (which would deliver the message to the very Session
 * the user was switching away from), the send is refused until the Session goes idle.
 *
 * A staged handoff has no such constraint: it never reads or writes the running Session.
 */
export function stagedSendRoute({
  handoffTarget,
  pendingModel,
  canSwitchModel,
  sessionBusy,
}: {
  /** An `/agent` handoff target is staged. */
  handoffTarget: boolean;
  /** A `/model` fork target is staged. */
  pendingModel: boolean;
  /** The host can actually perform a fork (an active session supplies onSwitchModel; the draft page does not). */
  canSwitchModel: boolean;
  /** This Session is running or compacting — its Trace is still being appended to. */
  sessionBusy: boolean;
}): StagedSendRoute {
  // The two chips are mutually exclusive by construction (picking either clears the other);
  // should they ever coexist, the handoff wins — it is the one that touches nothing here.
  if (handoffTarget) return "handoff";
  if (!pendingModel || !canSwitchModel) return "post";
  return sessionBusy ? "blocked" : "model";
}
