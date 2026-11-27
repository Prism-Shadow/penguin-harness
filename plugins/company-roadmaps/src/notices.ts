/**
 * The roadmap notices: what a roadmap write tells employees, as built-in notify Actions, one key
 * per event (`notify.roadmap.item_approved`). A write sends its notice once its write committed,
 * through the run's `act.notify` (company-proposals' registry runs the notify Action by key, as
 * the same caller), so an organization's company workflow that contributes an `action` on the
 * key replaces the built-in one. The built-in ones (builtin-actions.ts) put a line on each desk
 * of `to`, `notify_failed` recorded when one could not take it.
 *
 *   room_joined         each member's desk when the room opens or is bound, and each member a
 *                       change of members adds while the room discusses: the room it is in
 *   derived             a derived roadmap's moderator's desk: its room is open, or to open one
 *   approval_requested  the moderator's desk: approve the briefs
 *   item_approved       an item's owner's desk: its proposal was created (or rewritten)
 *   base_linked         a stacked item's owner's desk: its base's proposal number
 *   reopened            every member's desk: the roadmap is discussed again
 *
 * These are every line the plugin tells an employee; the discussion itself is the room's
 * channel, which the organization delivers.
 */
import type { NoticeOutcome, NoticeResult } from "./action-shapes.js";
import type { WriteAct } from "./guards.js";

/** The events a roadmap write tells employees of. */
export const ROADMAP_NOTICE_EVENTS = [
  "room_joined",
  "derived",
  "approval_requested",
  "item_approved",
  "base_linked",
  "reopened",
] as const;

export type RoadmapNoticeEvent = (typeof ROADMAP_NOTICE_EVENTS)[number];

/** The notify Action's key of an event. */
export function roadmapNoticeKey(event: RoadmapNoticeEvent): string {
  return `notify.roadmap.${event}`;
}

/** The ids of the built-in notify Actions, by event. */
export const ROADMAP_NOTICE_IDS: Record<RoadmapNoticeEvent, string> = {
  room_joined: "company-roadmaps.notify.room-joined",
  derived: "company-roadmaps.notify.derived",
  approval_requested: "company-roadmaps.notify.approval-requested",
  item_approved: "company-roadmaps.notify.item-approved",
  base_linked: "company-roadmaps.notify.base-linked",
  reopened: "company-roadmaps.notify.reopened",
};

/**
 * How a notice went, as the sending write records it. `delivered`: the first recipient was told
 * — listed among the result's `delivered` when the result has that list (a replacement that
 * delivers nothing says so), else not listed among its `failed`. `failed`: the recipients the
 * result lists as not told, or every recipient when the notice did not run.
 */
export interface NoticeSent {
  delivered: boolean;
  error?: string;
  failed: Array<{ agentId: string; error: string }>;
}

/**
 * Sends a notice of `event` through the write's `act.notify`, or — a use case called directly —
 * `fallback`, what the built-in one does. Each recipient not told is a hint (`hintOf`), and so is
 * a notice that did not run. Never throws: the write already stands.
 */
export async function sendNotice(
  act: Pick<WriteAct, "notify"> | undefined,
  event: RoadmapNoticeEvent,
  subject: string,
  params: { to: string[]; text: string } & Record<string, unknown>,
  fallback: () => Promise<NoticeResult>,
  hints: string[],
  hintOf: (failure: { agentId: string; error: string }) => string,
): Promise<NoticeSent> {
  const key = roadmapNoticeKey(event);
  const out: NoticeOutcome =
    act?.notify !== undefined
      ? await act.notify({ key, subject, params })
      : { ok: true, result: await fallback() };
  if (!out.ok) {
    hints.push(`${key} did not run: ${out.error}`);
    return {
      delivered: false,
      error: out.error,
      failed: params.to.map((agentId) => ({ agentId, error: out.error })),
    };
  }
  const failed = failuresOf(out.result);
  for (const f of failed) hints.push(hintOf(f));
  const first = params.to[0];
  const mine = failed.find((f) => f.agentId === first);
  const told = deliveredOf(out.result);
  const delivered =
    mine === undefined && (told === null || (first !== undefined && told.includes(first)));
  return {
    delivered,
    ...(mine !== undefined ? { error: mine.error } : {}),
    failed,
  };
}

/** The recipients a notify run's result lists as told, or null when it lists none (read leniently). */
function deliveredOf(result: unknown): string[] | null {
  const delivered = (result as { delivered?: unknown } | null)?.delivered;
  if (!Array.isArray(delivered)) return null;
  return delivered.filter((d): d is string => typeof d === "string");
}

/** The failures a notify run's result lists, read leniently (a replacement's result may be anything). */
function failuresOf(result: unknown): Array<{ agentId: string; error: string }> {
  const failed = (result as { failed?: unknown } | null)?.failed;
  if (!Array.isArray(failed)) return [];
  return failed.filter(
    (f): f is { agentId: string; error: string } =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as { agentId?: unknown }).agentId === "string" &&
      typeof (f as { error?: unknown }).error === "string",
  );
}
