/**
 * Port forwarding: the wanted set handed to a machine's session, what ssh's answers read as,
 * the local port chosen, both directions — and, on a hub whose ssh cannot carry forwards,
 * the listener this process binds instead, with real sockets on the loopback.
 */
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { PortForwardsRepo } from "../src/db/repos/port-forwards.js";
import type { ForwardSpec } from "../src/machines/commands.js";
import { forwardKey } from "../src/machines/transport/index.js";
import type { ForwardFact } from "../src/machines/transport/index.js";
import { PortForwardService } from "../src/port-forwards/service.js";
import type { ForwardCarrier, PortForwardInfo } from "../src/port-forwards/service.js";
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

const made = (result: Awaited<ReturnType<PortForwardService["create"]>>): PortForwardInfo => {
  if ("error" in result) throw new Error(`refused: ${result.error}`);
  return result;
};

/** A machine session double: what it was handed, what it answers, whether it is up. */
class FakeCarrier implements ForwardCarrier {
  supported = true;
  connected = true;
  wanted = new Map<string, ForwardSpec[]>();
  answers = new Map<string, ForwardFact>();
  dials = 0;
  constructor(private readonly machinePort: number) {}
  knows(machineId: string): boolean {
    return machineId === MACHINE;
  }
  async setForwards(machineId: string, specs: readonly ForwardSpec[]) {
    this.wanted.set(machineId, [...specs]);
    return { ok: true as const, supported: this.supported };
  }
  forwardFacts(machineId: string) {
    const facts = new Map<string, ForwardFact>();
    for (const spec of this.wanted.get(machineId) ?? []) {
      const answer = this.answers.get(forwardKey(spec));
      if (answer !== undefined) facts.set(forwardKey(spec), answer);
    }
    return { connected: this.connected, facts };
  }
  async dialPort(_machineId: string, remotePort: number) {
    this.dials++;
    if (!this.connected) return { ok: false as const, detail: "machine not connected" };
    return new Promise<{ ok: true; socket: net.Socket } | { ok: false; detail: string }>(
      (resolve) => {
        const socket = net.connect(remotePort, "127.0.0.1");
        socket.once("connect", () => resolve({ ok: true, socket }));
        socket.once("error", (err) => resolve({ ok: false, detail: err.message }));
      },
    );
  }
}

describe("PortForwardService", () => {
  let db: ReturnType<typeof openDatabase>;
  let repo: PortForwardsRepo;
  /** The "machine": echoes what it hears, upper-cased, so a reply proves the far end answered. */
  let machine: net.Server;
  let machinePort: number;
  let carrier: FakeCarrier;
  let services: PortForwardService[];

  const service = (): PortForwardService => {
    const made = new PortForwardService(repo, carrier, () => new Date("2026-09-19T08:00:00.000Z"));
    services.push(made);
    return made;
  };

  beforeEach(async () => {
    db = openDatabase(":memory:");
    repo = new PortForwardsRepo(db);
    services = [];
    machine = net.createServer({ allowHalfOpen: true }, (socket) => {
      let heard = "";
      socket.on("data", (chunk) => (heard += chunk.toString("utf8")));
      socket.on("end", () => socket.end(heard.toUpperCase()));
      socket.on("error", () => socket.destroy());
    });
    await new Promise<void>((resolve) => machine.listen(0, "127.0.0.1", resolve));
    machinePort = (machine.address() as AddressInfo).port;
    carrier = new FakeCarrier(machinePort);
  });

  afterEach(async () => {
    for (const each of services) each.stop();
    await new Promise<void>((resolve) => machine.close(() => resolve()));
    db.close();
  });

  describe("on the session (ssh -L / -R)", () => {
    it("hands the machine its wanted set, both directions spelled as ssh wants them", async () => {
      const forwards = service();
      const inbound = made(
        await forwards.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "in",
          remotePort: 3000,
          localPort: await freePort(),
        }),
      );
      const outbound = made(
        await forwards.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "out",
          remotePort: 5432,
          localPort: 5432,
        }),
      );
      expect(carrier.wanted.get(MACHINE)).toEqual([
        { direction: "in", localPort: inbound.localPort, remotePort: 3000 },
        { direction: "out", localPort: 5432, remotePort: 5432 },
      ]);
      expect(inbound).toMatchObject({ via: "ssh", direction: "in" });
      expect(outbound).toMatchObject({ via: "ssh", direction: "out" });
      expect(carrier.dials).toBe(0);

      // Removing one hands the machine the set without it.
      expect(await forwards.remove(inbound.id)).toBe(true);
      expect(carrier.wanted.get(MACHINE)).toEqual([
        { direction: "out", localPort: 5432, remotePort: 5432 },
      ]);
      expect(await forwards.remove(inbound.id)).toBe(false);
    });

    it("reads its status off the session: down, not yet answered, ssh said yes, ssh said no", async () => {
      const forwards = service();
      const forward = made(
        await forwards.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "in",
          remotePort: 3000,
          localPort: await freePort(),
        }),
      );
      const key = forwardKey({ direction: "in", localPort: forward.localPort, remotePort: 3000 });
      carrier.connected = false;
      expect(forwards.list()[0]!.status).toEqual({ kind: "not-connected" });
      carrier.connected = true;
      expect(forwards.list()[0]!.status).toEqual({ kind: "pending" });
      carrier.answers.set(key, { ok: true });
      expect(forwards.list()[0]!.status).toEqual({ kind: "active" });
      carrier.answers.set(key, {
        ok: false,
        detail: "remote port forwarding failed for listen port 3000",
      });
      expect(forwards.list()[0]!.status).toEqual({
        kind: "failed",
        detail: "remote port forwarding failed for listen port 3000",
      });
    });

    it("chooses the remote port's own number when it is free here, and walks up when it is not", async () => {
      const forwards = service();
      const remotePort = await freePort();
      const first = made(
        await forwards.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "in",
          remotePort,
        }),
      );
      expect(first.localPort).toBe(remotePort);
      const second = made(
        await forwards.create({
          machineId: MACHINE,
          workspace: "/home/dev/other",
          direction: "in",
          remotePort,
        }),
      );
      expect(second.localPort).toBeGreaterThan(remotePort);
    });

    it("refuses an unknown machine, a second forward of the same port, and a taken local port", async () => {
      const forwards = service();
      const localPort = await freePort();
      expect(
        await forwards.create({
          machineId: "nobody",
          workspace: WORKSPACE,
          direction: "in",
          remotePort: 3000,
        }),
      ).toEqual({
        error: "unknown_machine",
      });
      const first = made(
        await forwards.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "in",
          remotePort: 3000,
          localPort,
        }),
      );
      expect(
        await forwards.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "in",
          remotePort: 3000,
        }),
      ).toMatchObject({
        error: "forward_exists",
        existing: { id: first.id },
      });
      // Another Workspace may forward the same remote port — to a local port of its own.
      expect(
        await forwards.create({
          machineId: MACHINE,
          workspace: "/home/dev/other",
          direction: "in",
          remotePort: 3000,
          localPort,
        }),
      ).toEqual({ error: "local_port_in_use", localPort });
      // The same remote port the other way round is another forward, and may share the local port.
      expect(
        await forwards.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "out",
          remotePort: 3000,
          localPort,
        }),
      ).toMatchObject({ direction: "out" });
    });

    it("hands every machine its set at start, without touching a machine that is down", async () => {
      const before = service();
      made(
        await before.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "in",
          remotePort: 3000,
          localPort: await freePort(),
        }),
      );
      made(
        await before.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "out",
          remotePort: 8080,
          localPort: 8080,
        }),
      );
      carrier = new FakeCarrier(machinePort);
      carrier.connected = false;
      const after = service();
      await after.start();
      expect(carrier.wanted.get(MACHINE)).toHaveLength(2);
      expect(after.list().map((f) => f.status)).toEqual([
        { kind: "not-connected" },
        { kind: "not-connected" },
      ]);
      expect(carrier.dials).toBe(0);
    });
  });

  describe("on a hub whose ssh cannot carry forwards", () => {
    beforeEach(() => {
      carrier.supported = false;
    });

    it("binds an `in` forward here, carries bytes both ways, and dials only when someone connects", async () => {
      const forwards = service();
      const localPort = await freePort();
      const forward = made(
        await forwards.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "in",
          remotePort: machinePort,
          localPort,
        }),
      );
      expect(forward).toMatchObject({
        via: "listener",
        status: { kind: "active" },
        traffic: { open: 0 },
      });
      expect(carrier.dials).toBe(0);
      expect(await roundTrip(localPort, "hello")).toBe("HELLO");
      expect(carrier.dials).toBe(1);
      await waitFor(() => forwards.list()[0]!.traffic!.open === 0);
      expect(forwards.list()[0]!.traffic).toEqual({ open: 0, bytesUp: 5, bytesDown: 5 });
    });

    it("refuses an `out` forward: nothing here can make the machine listen", async () => {
      const forwards = service();
      expect(
        await forwards.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "out",
          remotePort: 5432,
          localPort: 5432,
        }),
      ).toEqual({ error: "unsupported_here" });
      expect(forwards.list()).toEqual([]);
    });

    it("keeps the reason when the machine is not connected, and reports a port it cannot bind", async () => {
      const forwards = service();
      const localPort = await freePort();
      const forward = made(
        await forwards.create({
          machineId: MACHINE,
          workspace: WORKSPACE,
          direction: "in",
          remotePort: machinePort,
          localPort,
        }),
      );
      carrier.connected = false;
      expect(await roundTrip(localPort, "hello")).toBe("");
      expect(forwards.list()[0]!.status).toEqual({
        kind: "failed",
        detail: "machine not connected",
      });
      forwards.stop();

      const squatter = net.createServer();
      await new Promise<void>((resolve) => squatter.listen(localPort, "127.0.0.1", resolve));
      try {
        const blocked = service();
        await blocked.start();
        expect(blocked.list()).toMatchObject([
          { id: forward.id, localPort, status: { kind: "failed", detail: "EADDRINUSE" } },
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
          direction: "in",
          remotePort: machinePort,
          localPort,
        }),
      );
      const client = net.connect(localPort, "127.0.0.1");
      await new Promise<void>((resolve) => client.once("connect", () => resolve()));
      await waitFor(() => forwards.list()[0]!.traffic!.open > 0);
      const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
      expect(await forwards.remove(forward.id)).toBe(true);
      await closed;
      expect(forwards.list()).toEqual([]);
      await expect(roundTrip(localPort, "x")).rejects.toThrow(/ECONNREFUSED/);
    });
  });

  it("lists by machine, and by Workspace within it", async () => {
    const forwards = service();
    const a = made(
      await forwards.create({
        machineId: MACHINE,
        workspace: WORKSPACE,
        direction: "in",
        remotePort: 3000,
      }),
    );
    const b = made(
      await forwards.create({
        machineId: MACHINE,
        workspace: "/home/dev/other",
        direction: "in",
        remotePort: 3000,
      }),
    );
    expect(forwards.list({ machineId: MACHINE }).map((f) => f.id)).toEqual([a.id, b.id]);
    expect(forwards.list({ machineId: MACHINE, workspace: WORKSPACE }).map((f) => f.id)).toEqual([
      a.id,
    ]);
    expect(forwards.list({ machineId: "nobody" })).toEqual([]);
  });
});
