/**
 * The Task Manager page's endpoint wrappers over the face's `apiFetch`, so they run on the Web
 * App's transport (and its test and gallery stand-ins) without importing the Web App. The
 * component gallery's mock coverage check walks this module beside the app's own
 * `api/endpoints.ts`.
 */
import { apiFetch } from "@prismshadow/penguin-web-plugin";
import type { TaskProcessSignal, TaskTreeResponse } from "../types";

/** The tree of what runs right now, in every Project the caller can open. */
export const getTaskTree = (idleLimit?: number) =>
  apiFetch<TaskTreeResponse>("/api/me/tasks", {
    query: typeof idleLimit === "number" ? { idleLimit } : undefined,
  });

/** Stops every running activity in a Session and archives it. */
export const killTaskSession = (sessionId: string) =>
  apiFetch<void>(`/api/me/tasks/sessions/${encodeURIComponent(sessionId)}/kill`, {
    method: "POST",
  });

/** Sends a signal to one process row (background command, running tool call or pending approval). */
export const signalTaskProcess = (
  sessionId: string,
  processId: string,
  signal: TaskProcessSignal,
) =>
  apiFetch<void>(
    `/api/me/tasks/sessions/${encodeURIComponent(sessionId)}/processes/${encodeURIComponent(processId)}/signal`,
    {
      method: "POST",
      body: { signal },
    },
  );
