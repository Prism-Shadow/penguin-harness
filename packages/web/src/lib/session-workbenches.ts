import type { SessionWorkbenchScope } from "@prismshadow/penguin-web-plugin";
import type { OpenPage } from "./page-layout";

export type { SessionWorkbenchScope } from "@prismshadow/penguin-web-plugin";

/** Identifiers are those registered by their owning modules in DockModule.panels. */
export const sessionWorkbenchEntries = {
  agents: false,
  memory: false,
  workspace: true,
  trace: false,
  messaging: false,
  schedules: false,
  terminal: true,
  "builtin-browser": true,
} as const;

export type SessionWorkbenchKind = keyof typeof sessionWorkbenchEntries;

export function isSessionWorkbenchKind(id: string): id is SessionWorkbenchKind {
  return Object.hasOwn(sessionWorkbenchEntries, id);
}

/** The app mark belongs to the tool, shared by all its Session-specific instances. */
export function sessionWorkbenchAppKey(kind: SessionWorkbenchKind): string {
  return "session-tools-" + kind;
}

export function sessionWorkbenchPath(kind: SessionWorkbenchKind): string {
  return "/session-tools/" + kind;
}

type SessionAddress = Pick<SessionWorkbenchScope, "projectId" | "machineId" | "sessionId">;

/** The Agent and the default directory come from the authorized Session, never from a URL. */
export function sessionWorkbenchPage(
  kind: SessionWorkbenchKind,
  scope: SessionAddress,
  title: string,
): OpenPage {
  const params = new URLSearchParams({ project: scope.projectId, session: scope.sessionId });
  if (scope.machineId !== null) params.set("machine", scope.machineId);
  const identity = [kind, scope.projectId, scope.machineId ?? "", scope.sessionId]
    .map(encodeURIComponent)
    .join("/");
  return {
    id: "app:session-tool/" + identity,
    kind: "system",
    title,
    path: sessionWorkbenchPath(kind) + "?" + params.toString(),
  };
}

export function sessionWorkbenchKindAt(path: string): SessionWorkbenchKind | null {
  const kind = path.split("?", 1)[0]?.match(/^\/session-tools\/([^/]+)$/)?.[1];
  return kind && isSessionWorkbenchKind(kind) ? kind : null;
}

export function parseSessionWorkbenchPage(
  page: Pick<OpenPage, "path">,
): { kind: SessionWorkbenchKind; address: SessionAddress } | null {
  const kind = sessionWorkbenchKindAt(page.path);
  const search = page.path.split("?", 2)[1];
  if (!kind || !search) return null;
  const params = new URLSearchParams(search);
  const projectId = params.get("project"),
    sessionId = params.get("session");
  if (!projectId || !sessionId) return null;
  return { kind, address: { projectId, sessionId, machineId: params.get("machine") || null } };
}
