/**
 * Who each Session acts for (see the SessionDrivers mechanism): the user who last started a run
 * in it, remembered in memory, else the owner of its Project, read from the index. In memory on
 * purpose — it is a fact about the runs of this server's life: after a restart or a hot swap a
 * Session acts for its Project's owner until someone starts a run in it again.
 *
 * runDriverOf is stricter, for what a `session-driver` plugin command runs as: only the person
 * whose run is in progress right now (RuntimeEntry.runDriver, set at launch under the Session
 * lock and cleared at its end), or for a subagent's Session that of its root; never the owner,
 * never a past run.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Projects } from "@prismshadow/penguin-library-project";
import type {
  AgentState,
  SessionDrivers,
  SessionIndex,
} from "@prismshadow/penguin-library-session";

/** The Sessions remembered; the oldest notes go first beyond it. */
const MAX_NOTED = 10_000;

@Component()
export class SessionDriverRegistry implements SessionDrivers {
  @Use() private readonly sessions!: SessionIndex;
  @Use() private readonly projects!: Projects;
  @Use() private readonly state!: AgentState;
  private readonly noted = new Map<string, string>();

  note(sessionId: string, userId: string): void {
    // Re-inserted, so the Map's order is the order of the latest notes.
    this.noted.delete(sessionId);
    this.noted.set(sessionId, userId);
    if (this.noted.size > MAX_NOTED) {
      const oldest = this.noted.keys().next().value;
      if (oldest !== undefined) this.noted.delete(oldest);
    }
  }

  driverOf(sessionId: string): string | null {
    const noted = this.noted.get(sessionId);
    if (noted !== undefined) return noted;
    const row = this.sessions.findById(sessionId);
    if (row === null) return null;
    return this.projects.findById(row.projectId)?.ownerUserId ?? null;
  }

  runDriverOf(sessionId: string): string | null {
    // A subagent runs inside its root's run, which is the one that has a driver.
    const root = this.state.childRoots.get(sessionId) ?? sessionId;
    const entry = this.state.entries.get(root);
    if (entry === undefined || entry.status !== "running") return null;
    return entry.runDriver ?? null;
  }
}
