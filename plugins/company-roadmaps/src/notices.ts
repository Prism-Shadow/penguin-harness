/**
 * The roadmap notices: what a roadmap write tells employees, as built-in notify Actions, one key
 * per event (`notify.roadmap.item_approved`). A write sends its notice once its write committed,
 * through the run's `act.notify` (company-proposals' registry runs the notify Action by key, as
 * the same caller), so an organization's company workflow that contributes an `action` on the
 * key replaces the built-in one. The built-in ones (builtin-actions.ts) deliver what the service
 * delivered before notices existed: a line on a desk, `notify_failed` recorded when it could not
 * be; or, for the approval request, a line into the moderator's room session.
 *
 * The other lines the service delivers — the room an employee joined, a derived roadmap's room,
 * a reopening — are not notices: they go to the desk directly.
 */
import type { NoticeOutcome, NoticeResult } from "./action-shapes.js";
import type { WriteAct } from "./guards.js";

/** The events a roadmap write tells employees of. */
export const ROADMAP_NOTICE_EVENTS = [
  "item_approved",
  "base_linked",
  "approval_requested",
] as const;

export type RoadmapNoticeEvent = (typeof ROADMAP_NOTICE_EVENTS)[number];

/** The notify Action's key of an event. */
export function roadmapNoticeKey(event: RoadmapNoticeEvent): string {
  return `notify.roadmap.${event}`;
}

/** The ids of the built-in notify Actions, by event. */
export const ROADMAP_NOTICE_IDS: Record<RoadmapNoticeEvent, string> = {
  item_approved: "company-roadmaps.notify.item-approved",
  base_linked: "company-roadmaps.notify.base-linked",
  approval_requested: "company-roadmaps.notify.approval-requested",
};

/** How a notice went, as the sending write records it: told, or why not. */
export interface NoticeSent {
  delivered: boolean;
  error?: string;
}

/**
 * Sends a notice of `event` through the write's `act.notify`, or — a use case called directly —
 * `fallback`, what the built-in one does. Each recipient not told is a hint (`hintOf`), and so is
 * a notice that did not run; answers whether the first recipient was told, for a write that
 * records its delivery.
 */
export async function sendNotice(
  act: Pick<WriteAct, "notify"> | undefined,
  event: RoadmapNoticeEvent,
  subject: string,
  params: { to: string[]; text: string; sessionId?: string },
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
    return { delivered: false, error: out.error };
  }
  const failed = failuresOf(out.result);
  for (const f of failed) hints.push(hintOf(f));
  const mine = failed.find((f) => f.agentId === params.to[0]);
  return mine === undefined ? { delivered: true } : { delivered: false, error: mine.error };
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
