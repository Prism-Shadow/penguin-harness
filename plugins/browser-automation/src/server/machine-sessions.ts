/**
 * Which machine holds a Session this server does not: what the browser routes ask before they
 * hold a page here for a conversation on a machine (machine-relay.ts relays it to that machine).
 * The machine vouches for its own Session — this server's index of machine Sessions is the
 * host's, not the plugin's — by answering `GET /api/sessions/:id` with that Session, in the
 * Project asked about. Only the machines that Project uses are asked, one after another (an open
 * is a person's click, and a Project has a handful of machines); `named` narrows it to one.
 */
import type { MachineApi } from "@prismshadow/penguin-server/plugin";

/** The machines a Project uses, with a client to each while it is connected (ProjectMachines). */
export type ProjectMachineApis = (
  projectId: string,
) => Promise<Array<{ machineId: string; api: Pick<MachineApi, "request"> | null }>>;

/** The machine of `projectId` that holds `sessionId` in that Project, or null. */
export async function machineHolding(
  machines: ProjectMachineApis,
  projectId: string,
  sessionId: string,
  named?: string,
): Promise<string | null> {
  for (const machine of await machines(projectId)) {
    if (machine.api === null || (named !== undefined && machine.machineId !== named)) continue;
    let answer: { status: number; text: string };
    try {
      answer = await machine.api.request("GET", `/api/sessions/${encodeURIComponent(sessionId)}`);
    } catch {
      // A machine that does not answer holds nothing we can open a page for.
      continue;
    }
    if (answer.status !== 200) continue;
    if (projectOf(answer.text) === projectId) return machine.machineId;
  }
  return null;
}

function projectOf(text: string): string | null {
  try {
    const body = JSON.parse(text) as { session?: { projectId?: unknown } } | null;
    const projectId = body?.session?.projectId;
    return typeof projectId === "string" ? projectId : null;
  } catch {
    return null;
  }
}
