/**
 * The sidebar's "delete workspace" (features/session-list/delete-workspace.ts): a group's active
 * conversations are archived on the server that holds them, then the group leaves the list and
 * its registry entry goes.
 *
 * - Given a Workspace with no active conversations, it is removed without asking any server.
 * - Given a Workspace with conversations, its server is asked once, with the machine id beside
 *   the path; then the open conversation is left (when it is in the group) before the group is
 *   archived locally, the registry entry goes, and the answer carries the server's count.
 * - Given the server refuses, nothing is removed, nothing is archived locally, and the error
 *   comes back.
 * - Given a machine's group, the request goes over the wire to that machine's proxy path with
 *   the group's path as `workspaceGroup` (the merged temporary group as `temp`).
 * - Given a 404 for the route from a machine, it reads as a machine too old for it; the same
 *   status for a Project the user cannot open, or from this server, does not.
 */
import { describe, expect, it } from "vitest";
import * as api from "../src/api/endpoints";
import { ApiError } from "../src/api/client";
import {
  deleteWorkspaceGroup,
  isOutdatedMachine,
  type DeleteWorkspaceDeps,
  type DeleteWorkspaceTarget,
} from "../src/features/session-list/delete-workspace";
import { workspaceGroupKey } from "../src/lib/session-grouping";
import { apiError, json, stubFetch } from "./helpers/fetch";

const MACHINE = "noeSE0FFHhNXl2J5";

const target = (over: Partial<DeleteWorkspaceTarget> = {}): DeleteWorkspaceTarget => ({
  key: workspaceGroupKey("/srv/app", MACHINE),
  path: "/srv/app",
  machineId: MACHINE,
  count: 3,
  ...over,
});

/** Deps that record every call in order; `archive` answers with `answer`. */
function recorded(answer: () => Promise<number>) {
  const calls: string[] = [];
  const deps: DeleteWorkspaceDeps = {
    archive: (group, machineId) => {
      calls.push(`archive ${group} on ${machineId ?? "here"}`);
      return answer();
    },
    leaveIfOpenIn: (key) => calls.push(`leave ${key}`),
    archiveGroup: (key) => calls.push(`archiveGroup ${key}`),
    unregister: (path, machineId) => calls.push(`unregister ${path} on ${machineId ?? "here"}`),
  };
  return { calls, deps };
}

describe("deleting a Workspace group", () => {
  it("removes an empty Workspace without asking any server", async () => {
    const { calls, deps } = recorded(() => Promise.reject(new Error("must not be asked")));
    expect(await deleteWorkspaceGroup(target({ count: 0 }), deps)).toEqual({
      ok: true,
      archived: 0,
    });
    expect(calls).toEqual([`unregister /srv/app on ${MACHINE}`]);
  });

  it("asks the group's server once, then leaves the open conversation, archives the group and drops its entry", async () => {
    const { calls, deps } = recorded(() => Promise.resolve(5));
    const key = workspaceGroupKey("/srv/app", MACHINE);
    expect(await deleteWorkspaceGroup(target(), deps)).toEqual({ ok: true, archived: 5 });
    // Leaving comes before the local archive: the page must not paint the stub of a row it is
    // about to drop.
    expect(calls).toEqual([
      `archive /srv/app on ${MACHINE}`,
      `leave ${key}`,
      `archiveGroup ${key}`,
      `unregister /srv/app on ${MACHINE}`,
    ]);
  });

  it("removes nothing when the server refuses, and hands the error back", async () => {
    const refusal = new ApiError(500, "internal", "boom");
    const { calls, deps } = recorded(() => Promise.reject(refusal));
    expect(await deleteWorkspaceGroup(target(), deps)).toEqual({ ok: false, error: refusal });
    expect(calls).toEqual([`archive /srv/app on ${MACHINE}`]);
  });

  it("sends a machine's group to that machine's proxy path, by path or as `temp`", async () => {
    const fetch = stubFetch(() => json({ done: 2 }));
    const { deps } = recorded(() => Promise.resolve(0));
    const wired: DeleteWorkspaceDeps = {
      ...deps,
      archive: (group, machineId) =>
        api.archiveWorkspaceSessions("p", group, machineId).then((r) => r.done),
    };
    expect(await deleteWorkspaceGroup(target(), wired)).toEqual({ ok: true, archived: 2 });
    const tempKey = workspaceGroupKey("/x/agents/a/workspaces/tmp-0123abcd", MACHINE);
    await deleteWorkspaceGroup(target({ key: tempKey }), wired);
    expect(
      fetch.requests.map(({ method, machine, path, body }) => ({ method, machine, path, body })),
    ).toEqual([
      {
        method: "POST",
        machine: MACHINE,
        path: "/api/projects/p/sessions/archive",
        body: { workspaceGroup: "/srv/app" },
      },
      {
        method: "POST",
        machine: MACHINE,
        path: "/api/projects/p/sessions/archive",
        body: { workspaceGroup: "temp" },
      },
    ]);
  });

  it("tells a machine too old for the route apart from a Project the user cannot open", async () => {
    const failure = async (response: Response, machineId: string | null) => {
      stubFetch(() => response);
      const outcome = await deleteWorkspaceGroup(target({ machineId }), {
        ...recorded(() => Promise.resolve(0)).deps,
        archive: (group, machine) =>
          api.archiveWorkspaceSessions("p", group, machine).then((r) => r.done),
      });
      if (outcome.ok) throw new Error("the delete should have failed");
      return isOutdatedMachine(outcome.error, machineId);
    };
    // A build that predates the route answers its unknown-route 404, with no error body.
    expect(await failure(new Response(null, { status: 404 }), MACHINE)).toBe(true);
    expect(await failure(apiError(404, "project_not_found"), MACHINE)).toBe(false);
    expect(await failure(new Response(null, { status: 404 }), null)).toBe(false);
    expect(await failure(apiError(502, "machine_unreachable"), MACHINE)).toBe(false);
  });
});
