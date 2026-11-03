/**
 * Following a delete's background removal on a progress card (the UI package's
 * `startProgress`). By the time this starts the Agent is already off every list; what is left is
 * the removal of its files, which on a large folder takes a while. The card appears only when it
 * does take a while, and it is driven from here rather than from the Agents page, so it stays on
 * screen wherever the user goes next.
 *
 * The removal is read from the server the Agent lived on every `DELETION_POLL_MS`. A deletion that
 * server no longer knows (404: finished long enough ago to be forgotten, or never recorded) reads
 * as finished — the Agent is gone either way. Reads that keep failing (the server out of reach)
 * end the card quietly after `READ_FAILURES_TO_STOP` in a row: the removal goes on without a
 * reader, and the server takes up whatever is left at its next start. Closing the card stops the
 * reads; nothing on the server depends on them.
 */
import type { AgentDeletionInfo } from "@prismshadow/penguin-server/api";
import { startProgress } from "@prismshadow/penguin-ui";
import type { ProgressHandle, ProgressPatch } from "@prismshadow/penguin-ui";
import { ApiError } from "../../api/client";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";

/** How often the removal is read, ms. */
export const DELETION_POLL_MS = 500;
/** Failed reads in a row after which the card stops following. */
export const READ_FAILURES_TO_STOP = 20;

/** The card's bar and line for one reading. */
function reading(d: AgentDeletionInfo): ProgressPatch {
  if (d.phase === "counting") return { detail: S.agent.deleteCounting(d.total) };
  return { detail: S.agent.deleteRemoving(d.removed, d.total), value: d.removed, max: d.total };
}

/** Moves the card to `d`; true once the removal is over. */
function show(card: ProgressHandle, name: string, d: AgentDeletionInfo): boolean {
  if (d.phase === "done") {
    card.finish({ title: S.agent.deletedAgent(name), detail: S.agent.deleteRemoved(d.total) });
    return true;
  }
  if (d.phase === "failed") {
    card.finish({
      failed: true,
      title: S.agent.deleteIncomplete(name),
      detail: S.agent.deleteRetryOnRestart(d.error ?? ""),
      value: d.removed,
      max: d.total,
    });
    return true;
  }
  card.update(reading(d));
  return false;
}

/**
 * Follows `deletion` (the delete's answer) until its removal is over or the card is closed.
 * Resolves then; never rejects.
 */
export async function followAgentDeletion(opts: {
  projectId: string;
  /** The machine the Agent lived on; null for this server. */
  machineId: string | null;
  /** The Agent's display name, for the card's title. */
  name: string;
  deletion: AgentDeletionInfo;
}): Promise<void> {
  const { projectId, machineId, name, deletion } = opts;
  if (deletion.phase === "done") return;
  const card = startProgress({ title: S.agent.deletingAgent(name), ...reading(deletion) });
  if (show(card, name, deletion)) return;
  let failures = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, DELETION_POLL_MS));
    if (card.closed) return;
    let next: AgentDeletionInfo;
    try {
      next = (await api.getAgentDeletion(projectId, deletion.deletionId, machineId)).deletion;
      failures = 0;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        card.finish({ title: S.agent.deletedAgent(name) });
        return;
      }
      failures += 1;
      if (failures >= READ_FAILURES_TO_STOP) {
        card.close();
        return;
      }
      continue;
    }
    if (card.closed) return;
    if (show(card, name, next)) return;
  }
}
