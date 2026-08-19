import type { SessionStatus } from "@prismshadow/penguin-server/api";

/**
 * Visual state carried by a Session row / chat header.
 *
 * `null` means "nothing has run here yet" and renders no glyph at all: a Session created but
 * never used has no activity to report, and an icon that says so would be noise on every fresh
 * row. Everything else has run at least once, so it always carries a glyph.
 */
export type SessionActivity = "running" | "compacting" | "completed" | "completedUnread" | null;

/**
 * The Session's glyph state.
 *
 * Live execution comes from the server (`running` / `compacting` / `idle`). A settled Session
 * splits by whether the user has looked at it since it last did anything — that read/unread
 * distinction is the client's, because the API models no read receipt (see session-seen.ts).
 *
 * `hasTrace` is the server's own "a Task has been started" flag, already on every list row: it
 * is what separates "finished" from "never ran", so idle-and-never-ran stays blank instead of
 * claiming completion.
 */
export function sessionActivity(
  status: SessionStatus,
  hasTrace: boolean,
  unread: boolean,
): SessionActivity {
  // Status first: a live run reports itself even in the window before its Trace is recorded.
  if (status === "running") return "running";
  if (status === "compacting") return "compacting";
  if (!hasTrace) return null;
  return unread ? "completedUnread" : "completed";
}
