/**
 * Deleting a Session: the one path DELETE /api/sessions/:id and the archive page's batch delete
 * share, so a Session goes the same way whichever surface the user deleted it from.
 *
 * A Session takes its subagent children with it. A child is listed nowhere — its parent's Agent
 * panel is the only door to it — so one left behind would be a conversation nobody can reach,
 * still holding its Trace files and its index row. The children are read from the `subagent`
 * pointer records of the parent's Trace (Traces.subagentChildren) once the parent's own runs have
 * stopped, since a run still in flight could spawn another; core spawns children one level deep,
 * and the walk recurses anyway, behind the same depth backstop the history read uses.
 *
 * Only the children a Session spawned itself are its own. A fork copies its source's history,
 * the source's pointer records with it, so its Trace names children that still belong to the
 * source — and that the source's history still shows. A pointer recorded before the Session was
 * created is one of those copies, and the child it names is left where it is.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { scratchpadDir } from "@prismshadow/penguin-core";
import type { SessionIndex, SessionOrigins } from "../mechanisms/sessions.js";
import type { Traces } from "../mechanisms/traces.js";
import type { UserDraftsStore } from "../mechanisms/account-data.js";

/** What deleting a Session reaches. */
export interface SessionDeletionDeps {
  /** The data root (the scratchpad lives under it). */
  root: string;
  manager: {
    /** Marks the Session as being deleted and aborts its runs; the runs' settling promises. */
    beginSessionDeletion(sessionId: string): Promise<void>[];
    endSessionDeletion(sessionId: string): void;
  };
  traces: Pick<Traces, "subagentChildren" | "deleteSessionTraces">;
  sessions: Pick<SessionIndex, "findById" | "deleteById">;
  /** Closes and drops the Session's messaging bindings (no-op when unbound). */
  unbindMessaging(sessionId: string): void;
  sources: Pick<SessionOrigins, "delete">;
  /** Every user's unsent drafts of the Session (its composer, its form answers). */
  drafts: Pick<UserDraftsStore, "deleteBySession">;
}

/** The Session to delete: its id, where its files live, and when it was created. */
export interface DeletedSession {
  sessionId: string;
  projectId: string;
  agentId: string;
  /** ISO time; a `subagent` pointer recorded before it was copied in by a fork. */
  createdAt: string;
}

/** How long a deletion waits for an aborted run's interrupt cleanup before removing its files. */
const RUN_SETTLE_MS = 5000;

/** Recursion backstop for the child walk (a tampered Trace could point at an ancestor). */
const MAX_CHILD_DEPTH = 4;

/**
 * Deletes `row` and every subagent child below it: each one's running work is aborted first
 * (new Tasks are refused with 409 meanwhile, so nothing recreates the Trace under the deletion),
 * then its Trace files, its scratchpad, its index row, its messaging bindings, its source
 * entry and every user's drafts of it go. Children are deleted before their parent. `onDeleted` hears each id as it goes, so a
 * failure part-way still announces what is already gone.
 */
export async function deleteSessionTree(
  deps: SessionDeletionDeps,
  row: DeletedSession,
  onDeleted: (sessionId: string) => void,
): Promise<void> {
  await deleteOne(deps, row, onDeleted, new Set([row.sessionId]), 0);
}

async function deleteOne(
  deps: SessionDeletionDeps,
  row: DeletedSession,
  onDeleted: (sessionId: string) => void,
  visited: Set<string>,
  depth: number,
): Promise<void> {
  const runnings = deps.manager.beginSessionDeletion(row.sessionId);
  try {
    // Interrupt cleanup writes the Trace asynchronously: wait for it (capped) before reading
    // the pointers and removing the files, or a late write would recreate what was deleted.
    if (runnings.length > 0) {
      await Promise.race([
        Promise.allSettled(runnings).then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, RUN_SETTLE_MS).unref?.()),
      ]);
    }
    if (depth < MAX_CHILD_DEPTH) {
      const children = await deps.traces.subagentChildren(
        row.projectId,
        row.agentId,
        row.sessionId,
      );
      for (const child of children) {
        if (visited.has(child.sessionId)) continue;
        // A pointer older than this Session came in with a fork's copy of its source's
        // history: the child is the source's. An unreadable time proves nothing either way,
        // and a child left behind costs less than one deleted from under another Session.
        if (!(Date.parse(child.spawnedAt) >= Date.parse(row.createdAt))) continue;
        visited.add(child.sessionId);
        // The index row is the better witness of where the child lives; a child that never
        // got one (a Trace another process wrote) is found through the Trace index instead.
        const childRow = deps.sessions.findById(child.sessionId);
        if (childRow !== null && childRow.projectId !== row.projectId) continue;
        const agentId = childRow?.agentId ?? child.agentId;
        if (agentId === null) continue;
        await deleteOne(
          deps,
          {
            sessionId: child.sessionId,
            projectId: row.projectId,
            agentId,
            // A child with no row was created when its pointer was recorded.
            createdAt: childRow?.createdAt ?? child.spawnedAt,
          },
          onDeleted,
          visited,
          depth + 1,
        );
      }
    }
    await deps.traces.deleteSessionTraces(row.projectId, row.agentId, row.sessionId);
    // The session-level scratchpad (model temp files + input images saved to disk for
    // image-unsupported models) goes with the Session.
    await fs.rm(path.join(scratchpadDir(deps.root, row.projectId, row.agentId), row.sessionId), {
      recursive: true,
      force: true,
    });
    deps.sessions.deleteById(row.sessionId);
    // A bound Session takes its messaging bindings with it: close the channel connection and
    // drop every channel's row (bulk Agent/Project deletes are reconciled by the bridge's next
    // start()).
    deps.unbindMessaging(row.sessionId);
    // Session ids are never reused, so a stale entry would never be matched; dropped anyway.
    deps.sources.delete(row.sessionId);
    // A draft of a Session that is gone has nowhere to be sent, in any user's browser.
    deps.drafts.deleteBySession(row.sessionId);
    onDeleted(row.sessionId);
  } finally {
    deps.manager.endSessionDeletion(row.sessionId);
  }
}
