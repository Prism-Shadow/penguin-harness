/**
 * The route state that carries "open this conversation with its scheduled-tasks panel and the
 * AI creation dialog up" — what the Session row menu's "Schedule a task → Create with AI"
 * hands to the chat page. One reader and one writer, so the key is spelled in one place.
 */

export const SCHEDULE_AI_ROUTE_STATE = { schedulePanel: "ai" } as const;

export function wantsScheduleAi(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as { schedulePanel?: unknown }).schedulePanel === SCHEDULE_AI_ROUTE_STATE.schedulePanel
  );
}
