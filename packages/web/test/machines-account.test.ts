// @vitest-environment jsdom
/**
 * The Project's machines as one live account (state/machines.tsx): what every machine surface
 * (the Machines page, the composer's machine link, the Session list's sources, the terminals)
 * reads, so all of them see the same machines at the same moment.
 *
 * - Given an admin, the list is read once when the account mounts, and again each time the
 *   server says it changed; changes that arrive while a read is in flight cost one more read,
 *   not one each, and the account ends on the newest answer.
 * - Given a Project switch while a read about the old Project is in flight, its late answer is
 *   dropped: the new Project's machines stand, and nothing of the old one shows meanwhile.
 * - Given a read that fails, the last list stands, the failure says why, and the account is
 *   settled — a surface waiting on it does not wait forever.
 * - Given a member (not an admin), nothing is read and the account is settled at once.
 * - Given an answer a request already brought (every machines POST answers with the list), the
 *   account takes it without reading again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { MachineInfo, MachinesResponse, MeResponse } from "@prismshadow/penguin-server/api";
import { ADMIN_ME } from "./helpers/admin-settings";
import { mount, run, settle, unmountAll } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";

const PROJECTS = ["alpha", "beta"] as const;
type ProjectId = (typeof PROJECTS)[number];

const MEMBER_ME: MeResponse = { ...ADMIN_ME, user: { ...ADMIN_ME.user, isAdmin: false } };

afterEach(async () => {
  await unmountAll();
  localStorage.clear();
});

/** A machine list naming one remote machine by `alias`. */
function machineList(alias: string): MachinesResponse {
  const machine: MachineInfo = {
    id: `ssh:${alias}`,
    alias,
    installed: { version: "0.2.16", at: "2026-10-15T00:00:00Z" },
    machineId: `${alias}-id`,
    local: false,
    connection: { pid: 1 },
    socket: null,
    api: null,
    status: null,
    root: "~/.penguin/data",
  };
  return { machines: [machine], imageVersion: "0.2.16", job: null, jobs: [] };
}

/**
 * The server: the signed-in user, two Projects, and each Project's machine list as the test sets
 * it. A machines read takes its answer when it is asked, and can be held until released (a read
 * in flight) — all at once, or one Project's at a time — or refused.
 */
function machinesServer(me: MeResponse = ADMIN_ME) {
  const lists: Record<ProjectId, MachinesResponse> = {
    alpha: machineList("alpha-box"),
    beta: machineList("beta-box"),
  };
  let holding = false;
  let held: Array<{ projectId: string; open: () => void }> = [];
  let refusing = false;
  const fetch = stubFetch(async (request) => {
    if (request.path === "/api/me") return json(me);
    if (request.path === "/api/me/prefs") return json({ prefs: {} });
    if (request.path === "/api/projects") {
      return json({
        projects: PROJECTS.map((projectId) => ({
          projectId,
          name: projectId,
          role: "owner",
          ownerUserId: "admin",
          createdAt: "2026-01-01T00:00:00Z",
        })),
      });
    }
    const machines = /^\/api\/projects\/([^/]+)\/machines$/.exec(request.path);
    if (machines !== null) {
      const projectId = machines[1]!;
      const answer = refusing
        ? apiError(503, "machines_unreadable", "The machine list could not be read.")
        : json(lists[projectId as ProjectId]);
      if (holding) await new Promise<void>((open) => held.push({ projectId, open }));
      return answer;
    }
    if (/^\/api\/projects\/[^/]+\/agents$/.test(request.path)) return json({ agents: [] });
    return apiError(404, "not_found");
  });
  return {
    lists,
    /** The machines reads so far, by Project. */
    reads: (projectId?: ProjectId) =>
      fetch.requests.filter((r) =>
        projectId === undefined
          ? r.path.endsWith("/machines")
          : r.path === `/api/projects/${projectId}/machines`,
      ),
    hold() {
      holding = true;
    },
    /** Answers the held reads — only `projectId`'s when named — and holds no more. */
    async release(projectId?: ProjectId) {
      holding = false;
      const going = held.filter((h) => projectId === undefined || h.projectId === projectId);
      held = held.filter((h) => !going.includes(h));
      for (const { open } of going) open();
      await settle();
      await settle();
    },
    refuse() {
      refusing = true;
    },
  };
}

/** The account and the Project store, from one module graph (they share contexts). */
async function mountAccount() {
  vi.resetModules();
  const machines = await import("../src/state/machines");
  const auth = await import("../src/state/auth");
  const project = await import("../src/state/project");
  const handles: {
    account?: ReturnType<typeof machines.useMachines>;
    switchTo?: (projectId: string) => void;
  } = {};
  function Probe() {
    const account = machines.useMachines();
    handles.account = account;
    handles.switchTo = project.useProject().setCurrentProjectId;
    const aliases = account.state?.machines.map((m) => m.alias).join(",") ?? "—";
    return h(
      "p",
      null,
      `${account.settled ? "settled" : "waiting"} ${aliases} ${account.error ?? ""}`,
    );
  }
  const mounted = await mount(
    h(
      auth.AuthProvider,
      null,
      h(project.ProjectProvider, null, h(machines.MachinesProvider, null, h(Probe))),
    ),
  );
  await settle();
  await settle();
  return {
    shown: () => mounted.container.textContent?.trim() ?? "",
    changed: () => run(() => machines.publishMachinesChanged()),
    switchTo: (projectId: ProjectId) => run(() => handles.switchTo!(projectId)),
    accept: (next: MachinesResponse) => run(() => handles.account!.accept(next)),
  };
}

describe("the machines account", () => {
  it("reads once on mount, once more for any number of changes during a read, and ends on the newest", async () => {
    const server = machinesServer();
    const account = await mountAccount();
    expect(account.shown()).toBe("settled alpha-box");
    expect(server.reads()).toHaveLength(1);

    server.hold();
    await account.changed();
    expect(server.reads()).toHaveLength(2);
    // The machine came back while that read was in flight: the server says so three times.
    server.lists.alpha = machineList("alpha-box-2");
    await account.changed();
    await account.changed();
    await account.changed();
    expect(server.reads()).toHaveLength(2);

    await server.release();
    expect(server.reads()).toHaveLength(3);
    expect(account.shown()).toBe("settled alpha-box-2");
  });

  it("drops a late answer about the Project the user left; the new Project's machines stand", async () => {
    const server = machinesServer();
    const account = await mountAccount();
    expect(account.shown()).toBe("settled alpha-box");

    server.hold();
    await account.changed();
    await account.switchTo("beta");
    // Nothing of alpha's is offered as beta's while beta's own list is on its way.
    expect(account.shown()).toBe("waiting —");

    // Beta's list arrives first; alpha's, asked earlier, arrives after it and must not win.
    await server.release("beta");
    expect(account.shown()).toBe("settled beta-box");
    await server.release("alpha");
    expect(server.reads("beta")).toHaveLength(1);
    expect(account.shown()).toBe("settled beta-box");
  });

  it("keeps the last list when a read fails, says why, and settles", async () => {
    const server = machinesServer();
    const account = await mountAccount();
    server.refuse();
    await account.changed();
    expect(account.shown()).toBe("settled alpha-box The machine list could not be read.");
  });

  it("reads nothing for a member, and is settled at once", async () => {
    const server = machinesServer(MEMBER_ME);
    const account = await mountAccount();
    await account.changed();
    expect(server.reads()).toEqual([]);
    expect(account.shown()).toBe("settled —");
  });

  it("takes the list a request already brought without reading again", async () => {
    const server = machinesServer();
    const account = await mountAccount();
    await account.accept(machineList("installed-box"));
    expect(account.shown()).toBe("settled installed-box");
    expect(server.reads()).toHaveLength(1);
  });
});
