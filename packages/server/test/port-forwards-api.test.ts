/**
 * The port forwarding API: who may use it, what it validates, and the refusals it names.
 * What a forward does with bytes is port-forwards.test.ts's; here the machine is a record
 * and nothing connects to it.
 */
import fs from "node:fs";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PortForwardInfo, PortForwardsResponse } from "../src/api/types.js";
import { openDatabase } from "../src/db/database.js";
import { MachinesRepo } from "../src/db/repos/machines.js";
import { MachinesService } from "../src/machines/service.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const LOCAL_ID = "TESTlocalID00000";
const MACHINE = "QS7J4YVgSovi-Z2c";
const WORKSPACE = "/home/dev/site";

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

describe("port forwarding API", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let machinesRoot: string;
  let store: DatabaseSync;

  beforeEach(async () => {
    machinesRoot = await makeTempRoot();
    store = openDatabase(":memory:");
    const repo = new MachinesRepo(store);
    repo.patch("ssh:build-box", { machineId: MACHINE, version: "9.9.9" });
    t = await createTestApp({
      machines: new MachinesService(machinesRoot, LOCAL_ID, repo, {
        listAliases: () => ["build-box"],
        session: () => null,
        supportsForwards: () => true,
        setForwards: async () => {},
        forwardFacts: () => new Map(),
      }),
    });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });

  afterEach(async () => {
    await t.cleanup();
    store.close();
    fs.rmSync(machinesRoot, { recursive: true, force: true });
  });

  it("is an admin's: a member is refused, a visitor is not signed in", async () => {
    const member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    expect((await member.get("/api/port-forwards")).status).toBe(403);
    expect((await t.app.request("/api/port-forwards")).status).toBe(401);
  });

  it("forwards a port, lists it by machine and Workspace, and forgets it", async () => {
    const localPort = await freePort();
    const created = await admin.post("/api/port-forwards", {
      machineId: MACHINE,
      workspace: WORKSPACE,
      remotePort: 3000,
      localPort,
    });
    expect(created.status).toBe(201);
    const forward = (await created.json()) as PortForwardInfo;
    expect(forward).toMatchObject({
      machineId: MACHINE,
      workspace: WORKSPACE,
      direction: "in",
      remotePort: 3000,
      localPort,
      via: "ssh",
      status: { kind: "not-connected" },
    });

    const query = `machine=${MACHINE}&workspace=${encodeURIComponent(WORKSPACE)}`;
    const listed = (await (
      await admin.get(`/api/port-forwards?${query}`)
    ).json()) as PortForwardsResponse;
    expect(listed.forwards.map((f) => f.id)).toEqual([forward.id]);
    const elsewhere = (await (
      await admin.get(`/api/port-forwards?machine=${MACHINE}&workspace=%2Felsewhere`)
    ).json()) as PortForwardsResponse;
    expect(elsewhere.forwards).toEqual([]);

    expect((await admin.delete(`/api/port-forwards/${forward.id}`)).status).toBe(204);
    expect((await admin.delete(`/api/port-forwards/${forward.id}`)).status).toBe(404);
  });

  it("names each refusal", async () => {
    const localPort = await freePort();
    const body = { machineId: MACHINE, workspace: WORKSPACE, remotePort: 3000, localPort };
    expect((await admin.post("/api/port-forwards", { ...body, machineId: "nobody" })).status).toBe(
      404,
    );
    expect((await admin.post("/api/port-forwards", body)).status).toBe(201);

    const again = await admin.post("/api/port-forwards", body);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("forward_exists");

    const taken = await admin.post("/api/port-forwards", { ...body, workspace: "/elsewhere" });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: { code: string } }).error.code).toBe(
      "local_port_in_use",
    );
  });

  it("takes an out forward, which names the local service it sends", async () => {
    const out = await admin.post("/api/port-forwards", {
      machineId: MACHINE,
      workspace: WORKSPACE,
      direction: "out",
      remotePort: 5432,
      localPort: 5432,
    });
    expect(out.status).toBe(201);
    expect((await out.json()) as PortForwardInfo).toMatchObject({ direction: "out", via: "ssh" });
    const unnamed = await admin.post("/api/port-forwards", {
      machineId: MACHINE,
      workspace: WORKSPACE,
      direction: "out",
      remotePort: 5433,
    });
    expect(unnamed.status).toBe(400);
  });

  it("validates the ports and the filter", async () => {
    const body = { machineId: MACHINE, workspace: WORKSPACE, remotePort: 3000 };
    expect((await admin.post("/api/port-forwards", { ...body, direction: "up" })).status).toBe(400);
    expect((await admin.post("/api/port-forwards", { ...body, remotePort: 0 })).status).toBe(400);
    expect((await admin.post("/api/port-forwards", { ...body, remotePort: "3000" })).status).toBe(
      400,
    );
    expect((await admin.post("/api/port-forwards", { ...body, localPort: 80 })).status).toBe(400);
    expect((await admin.post("/api/port-forwards", { ...body, workspace: "" })).status).toBe(400);
    expect((await admin.get("/api/port-forwards?workspace=%2Fx")).status).toBe(400);
  });
});

describe("Machines.dialPort", () => {
  let machinesRoot: string;
  let store: DatabaseSync;

  beforeEach(async () => {
    machinesRoot = await makeTempRoot();
    store = openDatabase(":memory:");
    new MachinesRepo(store).patch("ssh:build-box", { machineId: MACHINE, version: "9.9.9" });
  });

  afterEach(() => {
    store.close();
    fs.rmSync(machinesRoot, { recursive: true, force: true });
  });

  it("does not dial a machine that is not held — a saved forward reopens no ssh", async () => {
    let dials = 0;
    const machines = new MachinesService(machinesRoot, LOCAL_ID, new MachinesRepo(store), {
      listAliases: () => ["build-box"],
      session: () => null,
      dial: async () => {
        dials++;
        return new net.Socket();
      },
    });
    expect(await machines.dialPort(MACHINE, 3000)).toEqual({
      ok: false,
      detail: "machine not connected",
    });
    expect(await machines.dialPort("nobody", 3000)).toEqual({
      ok: false,
      detail: "unknown machine",
    });
    expect(dials).toBe(0);
  });

  it("dials through the held connection, by alias, and reports a dial that fails", async () => {
    const asked: Array<[string, number]> = [];
    const socket = new net.Socket();
    let fail = false;
    const machines = new MachinesService(machinesRoot, LOCAL_ID, new MachinesRepo(store), {
      listAliases: () => ["build-box"],
      session: (address) => (address === "ssh:build-box" ? { pid: 1, socksPort: 1 } : null),
      dial: async (target, remotePort) => {
        asked.push([target.alias, remotePort]);
        if (fail) throw new Error("connection refused");
        return socket;
      },
    });
    expect(await machines.dialPort(MACHINE, 3000)).toEqual({ ok: true, socket });
    expect(asked).toEqual([["build-box", 3000]]);
    fail = true;
    expect(await machines.dialPort(MACHINE, 3000)).toEqual({
      ok: false,
      detail: "connection refused",
    });
  });
});
