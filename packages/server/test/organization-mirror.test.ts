/**
 * An organization whose shared workspace is on another machine: it is created THERE and runs
 * there, and belongs to the Project here as a mirror. Two harnesses stand for the two servers;
 * the "connection" between them is a fake machine API that calls the other side's service the
 * way its routes do.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OrganizationCreateRequest } from "../src/api/types.js";
import type { OrgMachineApi } from "../src/runtime/organization/deps.js";
import { makeOrgHarness } from "./org-harness.js";
import type { OrgHarness } from "./org-harness.js";

const P = "p1";
const ORG = "co_remote";
const MACHINE = "m-1";
const NOW = Date.parse("2026-09-19T09:00:00Z");

/** The machine's organization routes, as far as a mirror and a remote create use them. */
function apiOf(machine: OrgHarness): OrgMachineApi {
  const base = `/api/projects/${P}/organizations`;
  return {
    async request(method, url, body) {
      const [pathname, query = ""] = url.split("?");
      const json = (status: number, value: unknown) => ({ status, text: JSON.stringify(value) });
      try {
        if (method === "GET" && pathname === base) {
          return json(200, { organizations: await machine.service.list(P) });
        }
        if (method === "POST" && pathname === base) {
          return json(
            201,
            await machine.service.create(P, body as OrganizationCreateRequest, "machine-admin"),
          );
        }
        if (method === "GET" && pathname === `${base}/${ORG}/mirror`) {
          return json(200, { files: await machine.service.mirrorFiles(P, ORG) });
        }
        if (method === "GET" && pathname === `${base}/${ORG}/mirror/file`) {
          const rel = new URLSearchParams(query).get("path") ?? "";
          const bytes = await machine.service.mirrorFile(P, ORG, rel);
          return json(200, { base64: bytes.toString("base64") });
        }
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        return json(e.status ?? 500, { error: { code: e.code, message: e.message } });
      }
      return json(404, { error: { code: "not_found", message: url } });
    },
  };
}

describe("an organization on another machine", () => {
  const made: OrgHarness[] = [];
  afterEach(async () => {
    for (const h of made.splice(0)) await fs.rm(h.root, { recursive: true, force: true });
  });

  async function twoServers(connected = true) {
    const machine = await makeOrgHarness({
      nowMs: NOW,
      ownerUserId: "machine-admin",
      machines: { ownId: () => MACHINE, api: async () => null },
    });
    const link = { up: connected };
    const here = await makeOrgHarness({
      nowMs: NOW,
      machines: {
        ownId: () => "here",
        api: async (id) => (id === MACHINE && link.up ? apiOf(machine) : null),
      },
    });
    made.push(machine, here);
    const workspace = path.join(machine.root, "shared");
    await fs.mkdir(workspace, { recursive: true });
    return { machine, here, workspace, link };
  }

  it("is created and run THERE, and belongs to the Project here as a mirror", async () => {
    const { machine, here, workspace } = await twoServers();
    const detail = await here.service.create(
      P,
      { orgId: ORG, mission: "Ship it", workspace, workspaceMachine: MACHINE },
      "alice",
    );
    expect(detail).toMatchObject({ orgId: ORG, machineId: MACHINE });

    // The machine did the creating: the CEO's Agent, its desk and the first work round.
    expect(machine.agentsCreated.map((a) => a.agentId)).toEqual([`${ORG}_ceo`]);
    expect(machine.created).toHaveLength(1);
    expect(machine.started).toHaveLength(1);
    // This server made no Agent and opened no Session — not now, and not when its pass runs.
    await here.scheduler.tickOnce();
    expect(here.agentsCreated).toEqual([]);
    expect(here.created).toEqual([]);
    expect(here.started).toEqual([]);

    // The Project here holds the organization's files, and they say where it runs.
    const dir = here.store.dir(P, ORG);
    const config = (await here.store.readConfig(dir))!.parsed;
    expect(config).toMatchObject({ ok: true, value: { workspace, workspaceMachine: MACHINE } });
    expect(await fs.readFile(path.join(dir, "org_chart.yaml"), "utf8")).toBe(
      await fs.readFile(path.join(machine.store.dir(P, ORG), "org_chart.yaml"), "utf8"),
    );
    // There it simply runs: the id it carries is that server's own.
    await machine.scheduler.tickOnce();
    expect(machine.errors).toEqual([]);

    // One list, from here, with where it runs and what the machine knows of it.
    const [listed] = await here.service.list(P);
    expect(listed).toMatchObject({ orgId: ORG, machineId: MACHINE, employeeCount: 1 });
    expect((await machine.service.list(P))[0]!.machineId).toBeUndefined();
  });

  it("copies what the machine writes — new files, changed files, and files it no longer has", async () => {
    const { machine, here, workspace } = await twoServers();
    await here.service.create(
      P,
      { orgId: ORG, mission: "Ship it", workspace, workspaceMachine: MACHINE },
      "alice",
    );
    const ticket = await machine.service.createTicket(
      P,
      ORG,
      { title: "First ticket", owner: `agent:${ORG}_ceo` },
      { userId: "machine-admin" },
    );
    await here.scheduler.tickOnce();
    const mine = await here.service.tickets(P, ORG);
    expect(
      Object.values(mine.columns)
        .flat()
        .map((t) => t.ticketId),
    ).toContain(ticket.ticketId);

    await machine.service.writeHandbookFile(P, ORG, "notes/today.md", "# v1\n");
    await here.scheduler.tickOnce();
    const copy = path.join(here.store.dir(P, ORG), "handbook", "notes", "today.md");
    expect(await fs.readFile(copy, "utf8")).toBe("# v1\n");
    await machine.service.writeHandbookFile(P, ORG, "notes/today.md", "# v2\n");
    await here.scheduler.tickOnce();
    expect(await fs.readFile(copy, "utf8")).toBe("# v2\n");
    await machine.service.deleteHandbookFile(P, ORG, "notes/today.md");
    await here.scheduler.tickOnce();
    await expect(fs.stat(copy)).rejects.toThrow();
    // The shared workspace is a directory on that machine, no part of the organization's files.
    await fs
      .writeFile(path.join(machine.store.dir(P, ORG), "workspace", "big.bin"), "x")
      .catch(() => undefined);
    expect(
      (await machine.service.mirrorFiles(P, ORG)).some((f) => f.path.startsWith("workspace/")),
    ).toBe(false);
  });

  it("keeps the mirror as it is while the machine cannot be reached, and refuses to create on one", async () => {
    const { here, workspace, link } = await twoServers();
    await here.service.create(
      P,
      { orgId: ORG, mission: "Ship it", workspace, workspaceMachine: MACHINE },
      "alice",
    );
    link.up = false;
    await here.scheduler.tickOnce();
    expect((await here.service.list(P)).map((o) => [o.orgId, o.machineId])).toEqual([
      [ORG, MACHINE],
    ]);
    expect(here.created).toEqual([]);
    await expect(
      here.service.create(
        P,
        { orgId: "co_other", mission: "x", workspace, workspaceMachine: MACHINE },
        "alice",
      ),
    ).rejects.toMatchObject({ status: 409, code: "machine_not_connected" });
  });

  it("says in the machine's own words why it would not create one", async () => {
    const { here, machine } = await twoServers();
    await expect(
      here.service.create(
        P,
        {
          orgId: ORG,
          mission: "x",
          workspace: path.join(machine.root, "no-such-dir"),
          workspaceMachine: MACHINE,
        },
        "alice",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(await here.store.exists(P, ORG)).toBe(false);
  });
});
