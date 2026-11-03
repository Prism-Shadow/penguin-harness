/**
 * Who each Session acts for (see the SessionDrivers mechanism): the user who last started a run
 * in it, remembered in memory, else the owner of its Project, read from the index. In memory on
 * purpose — it is a fact about the runs of this server's life: after a restart or a hot swap a
 * Session acts for its Project's owner until someone starts a run in it again.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Projects } from "../mechanisms/projects.js";
import type { SessionDrivers, SessionIndex } from "../mechanisms/sessions.js";

/** The Sessions remembered; the oldest notes go first beyond it. */
const MAX_NOTED = 10_000;

@Component()
export class SessionDriverRegistry implements SessionDrivers {
  @Use() private readonly sessions!: SessionIndex;
  @Use() private readonly projects!: Projects;
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
}
