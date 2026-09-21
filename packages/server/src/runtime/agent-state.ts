/**
 * The Session runtime's in-memory state, held apart from the logic that works on it.
 *
 * Everything a SessionManager remembers between two calls lives here and nowhere else: the
 * manager's own fields of the same names point at these, so its logic reads and writes them
 * exactly as it did when it owned them. The component holds data only — no method here
 * decides anything.
 *
 * What is NOT here was never the manager's to hold: the Trace and the `sessions` rows are on
 * disk, and the database, the channel hub and the auth state belong to the process.
 */
import { Component } from "@prismshadow/penguin-core/kernel";
import type { SessionStatus } from "../api/types.js";
import type { AgentState } from "../mechanisms/sessions.js";
import { LiveTailTracker } from "./live-tail.js";
import type { LiveTail } from "./live-tail.js";
import type { RuntimeEntry } from "./session-manager.js";

@Component()
export class AgentStateStore implements AgentState {
  /** The active table: one entry per loaded runtime Session. */
  readonly entries = new Map<string, RuntimeEntry>();
  /** Each registered subagent Session's root Session (see SessionManager.rootSessionOf). */
  readonly childRoots = new Map<string, string>();
  /** Surface Sessions' states, by id (see SessionManager.setSurfaceStatus). */
  readonly surfaceStatuses = new Map<string, SessionStatus>();
  /** Per-Session mutex chains (see SessionManager.withLock). */
  readonly locks = new Map<string, Promise<unknown>>();
  /** Agents currently being deleted (key = agentKey). */
  readonly deletingAgents = new Set<string>();
  /** Sessions currently being deleted. */
  readonly deletingSessions = new Set<string>();
  /** Per-Agent config generation (key = agentKey). */
  readonly agentGenerations = new Map<string, number>();
  /** Open streaming fragments of running sessions. */
  readonly liveTail: LiveTail = new LiveTailTracker();
}
