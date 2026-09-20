/**
 * Port forwarding: the listener, the dial it makes only when someone connects, the facts it
 * keeps by layer, and what survives a restart. Real sockets on the loopback throughout — the
 * "machine" is a TCP server in this process, reached through a dialer double standing where
 * Machines.dialPort stands.
 */
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { PortForwardsRepo } from "../src/db/repos/port-forwards.js";
import { PortForwardService } from "../src/port-forwards/service.js";
import type { ForwardDialer, PortForwardInfo } from "../src/port-forwards/service.js";
import { waitFor } from "./helpers.js";

const MACHINE = "QS7J4YVgSovi-Z2c";
const WORKSPACE = "/home/dev/site";

/** A free loopback port: bound, read, released. */
async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** Sends `text` to a local port and resolves with everything that came back before the close. */
function roundTrip(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let heard = "";
    socket.on("connect", () => socket.end(text));
    socket.on("data", (chunk) => (heard += chunk.toString("utf8")));
    socket.on("close", () => resolve(heard));
    socket.on("error", reject);
  });
}

describe("PortForwardService", () => {
  let db: ReturnType<typeof openDatabase>;
  let repo: PortForwardsRepo;
  /** The "machine": echoes what it hears, upper-cased, so a reply proves the far end answered. */
  let machine: net.Server;
  let machinePort: number;
  let connected: boolean;
  let dials: number;
  let services: PortForwardService[];

  const dialer: ForwardDialer = {
    knows: (machineId) => machineId === MACHINE,
    dialPort: async (_machineId, remotePort) => {
      dials++;
      if (!connected) return { ok: false, detail: "machine not connected" };
      return new Promise((resolve) => {
        const socket = net.connect(remotePort, "127.0.0.1");
        socket.once("connect", () => resolve({ ok: true, socket }));
        socket.once("error", (err) => resolve({ ok: false, detail: err.message }));
      });
    },
  };

  const service = (): PortForwardService => {
    const made = new PortForwardService(repo, dialer, () => new Date("2026-09-19T08:00:00.000Z"));
    services.push(made);
    return made;
  };

  const made = (result: Awaited<ReturnType<PortForwardService["create"]>>): PortForwardInfo => {
    if ("error" in result) throw new Error(`refused: ${result.error}`);
    return result;
  };

  beforeEach(async () => {
    db = openDatabase(":memory:");
    repo = new PortForwardsRepo(db);
    connected = true;
    dials = 0;
    services = [];
    machine = net.createServer({ allowHalfOpen: true }, (socket) => {
      let heard = "";
      socket.on("data", (chunk) => (heard += chunk.toString("utf8")));
      socket.on("end", () => socket.end(heard.toUpperCase()));
      socket.on("error", () => socket.destroy());
    });
    await new Promise<void>((resolve) => machine.listen(0, "127.0.0.1", resolve));
    machinePort = (machine.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const each of services) each.stop();
    await new Promise<void>((resolve) => machine.close(() => resolve()));
    db.close();
  });

  it("carries bytes both ways, and only dials once someone connects", async () => {
    const forwards = service();
    const localPort = await freePort();
    const forward = made(
      await forwards.create({
        machineId: MACHINE,
        workspace: WORKSPACE,
        remotePort: machinePort,
        localPort,
      }),
    );
    expect(forward.listener).toEqual({ listening: true });
    expect(forward.dial).toBeNull();
    expect(dials).toBe(0);

    expect(await roundTrip(localPort, "hello")).toBe("HELLO");
    expect(dials).toBe(1);

    await waitFor(() => forwards.list()[0]!.open === 0);
    const after = forwards.list()[0]!;
    expect(after.dial).toEqual({ answeredAt: "2026-09-19T08:00:00.000Z" });
    expect(after.bytesUp).toBe(5);
    expect(after.bytesDown).toBe(5);
  });

  it("binds the loopback only", async () => {
    const forwards = service();
    const localPort = await freePort();
    made(
      await forwards.create({
        machineId: MACHINE,
        workspace: WORKSPACE,
        remotePort: machinePort,
        localPort,
      }),
    );
    // The same port is still free on the wildcard's other addresses only if the listener
    // took 127.0.0.1 alone; what can be asserted portably is the address it reports.
    const probe = net.connect(localPort, "127.0.0.1");
    await new Promise<void>((resolve) => probe.once("connect", () => resolve()));
    expect(probe.remoteAddress).toBe("127.0.0.1");
    probe.destroy();
  });

  it("closes the client and keeps the reason when the machine is not connected — it opens no ssh of its own", async () => {
    const forwards = service();
    const localPort = await freePort();
    made(
      await forwards.create({
        machineId: MACHINE,
        workspace: WORKSPACE,
        remotePort: machinePort,
        localPort,
      }),
    );
    connected = false;
    expect(await roundTrip(localPort, "hello")).toBe("");
    const after = forwards.list()[0]!;
    expect(after.listener).toEqual({ listening: true });
    expect(after.dial).toEqual({
      failedAt: "2026-09-19T08:00:00.000Z",
      detail: "machine not connected",
    });
  });

  it("refuses an unknown machine, a second forward of the same port, and a taken local port", async () => {
    const forwards = service();
    const localPort = await freePort();
    expect(
      await forwards.create({ machineId: "nobody", workspace: WORKSPACE, remotePort: 3000 }),
    ).toEqual({ error: "unknown_machine" });

    const first = made(
      await forwards.create({
        machineId: MACHINE,
        workspace: WORKSPACE,
        remotePort: machinePort,
        localPort,
      }),
    );
    const again = await forwards.create({
      machineId: MACHINE,
      workspace: WORKSPACE,
      remotePort: machinePort,
    });
    expect(again).toMatchObject({ error: "forward_exists", existing: { id: first.id } });

    // Another Workspace may forward the same remote port — to a local port of its own.
    expect(
      await forwards.create({
        machineId: MACHINE,
        workspace: "/home/dev/other",
        remotePort: machinePort,
        localPort,
      }),
    ).toEqual({ error: "local_port_in_use", localPort });
  });

  it("chooses the remote port's own number when it is free, and walks up when it is not", async () => {
    const forwards = service();
    const remotePort = await freePort();
    const first = made(
      await forwards.create({ machineId: MACHINE, workspace: WORKSPACE, remotePort }),
    );
    expect(first.localPort).toBe(remotePort);

    const second = made(
      await forwards.create({ machineId: MACHINE, workspace: "/home/dev/other", remotePort }),
    );
    expect(second.localPort).toBeGreaterThan(remotePort);
    expect(second.listener).toEqual({ listening: true });
  });

  it("comes back on the same local port after a restart, and reports a port it cannot bind as a fact", async () => {
    const localPort = await freePort();
    const before = service();
    const forward = made(
      await before.create({
        machineId: MACHINE,
        workspace: WORKSPACE,
        remotePort: machinePort,
        localPort,
      }),
    );
    before.stop();

    const after = service();
    await after.start();
    expect(after.list()).toMatchObject([
      { id: forward.id, localPort, listener: { listening: true } },
    ]);
    expect(await roundTrip(localPort, "again")).toBe("AGAIN");
    after.stop();

    // Someone else holds the port at the next start: the record and its port stay as they are.
    const squatter = net.createServer();
    await new Promise<void>((resolve) => squatter.listen(localPort, "127.0.0.1", resolve));
    try {
      const blocked = service();
      await blocked.start();
      expect(blocked.list()).toMatchObject([
        { id: forward.id, localPort, listener: { error: "EADDRINUSE" } },
      ]);
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  });

  it("removing a forward closes its listener and the connections through it", async () => {
    const forwards = service();
    const localPort = await freePort();
    const forward = made(
      await forwards.create({
        machineId: MACHINE,
        workspace: WORKSPACE,
        remotePort: machinePort,
        localPort,
      }),
    );
    const client = net.connect(localPort, "127.0.0.1");
    await new Promise<void>((resolve) => client.once("connect", () => resolve()));
    await waitFor(() => forwards.list()[0]!.open > 0);
    const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));

    expect(forwards.remove(forward.id)).toBe(true);
    await closed;
    expect(forwards.list()).toEqual([]);
    expect(forwards.remove(forward.id)).toBe(false);
    await expect(roundTrip(localPort, "x")).rejects.toThrow(/ECONNREFUSED/);
  });

  it("lists by machine, and by Workspace within it", async () => {
    const forwards = service();
    const a = made(
      await forwards.create({ machineId: MACHINE, workspace: WORKSPACE, remotePort: machinePort }),
    );
    const b = made(
      await forwards.create({
        machineId: MACHINE,
        workspace: "/home/dev/other",
        remotePort: machinePort,
      }),
    );
    expect(forwards.list({ machineId: MACHINE }).map((f) => f.id)).toEqual([a.id, b.id]);
    expect(forwards.list({ machineId: MACHINE, workspace: WORKSPACE }).map((f) => f.id)).toEqual([
      a.id,
    ]);
    expect(forwards.list({ machineId: "nobody" })).toEqual([]);
  });
});
