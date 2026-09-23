/**
 * Port forwarding: the wanted set handed to a machine's session, what ssh's answers read as,
 * the local port chosen, both directions.
 */
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { PortForwardsRepo } from "../src/db/repos/port-forwards.js";
import type { ForwardExposure, ForwardSpec } from "../src/machines/commands.js";
import { forwardKey } from "../src/machines/transport/index.js";
import type { ForwardFact } from "../src/machines/transport/index.js";
import { PortForwardService } from "../src/port-forwards/service.js";
import type { ForwardCarrier, PortForwardInfo } from "../src/port-forwards/service.js";

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

const made = (result: Awaited<ReturnType<PortForwardService["create"]>>): PortForwardInfo => {
  if ("error" in result) throw new Error(`refused: ${result.error}`);
  return result;
};

/** A machine session double: what it was handed, what it answers, whether it is up. */
class FakeCarrier implements ForwardCarrier {
  connected = true;
  wanted = new Map<string, ForwardSpec[]>();
  answers = new Map<string, ForwardFact>();
  /** What the machine's sshd does with an out forward's bind, and how often it was asked. */
  exposure: ForwardExposure = { mode: "loopback" };
  probes = 0;
  knows(machineId: string): boolean {
    return machineId === MACHINE;
  }
  known() {
    return [{ machineId: MACHINE, alias: "build-box" }];
  }
  async forwardExposure(): Promise<ForwardExposure> {
    this.probes += 1;
    return this.exposure;
  }
  async setForwards(machineId: string, specs: readonly ForwardSpec[]) {
    this.wanted.set(machineId, [...specs]);
    return { ok: true as const };
  }
  forwardFacts(machineId: string) {
    const facts = new Map<string, ForwardFact>();
    for (const spec of this.wanted.get(machineId) ?? []) {
      const answer = this.answers.get(forwardKey(spec));
      if (answer !== undefined) facts.set(forwardKey(spec), answer);
    }
    return { connected: this.connected, facts };
  }
}

describe("PortForwardService", () => {
  let db: ReturnType<typeof openDatabase>;
  let repo: PortForwardsRepo;
  let carrier: FakeCarrier;
  let allowed: Set<string>;
  let clock: Date;

  const service = (): PortForwardService =>
    new PortForwardService(
      repo,
      carrier,
      {
        allowed: (machineId) => allowed.has(machineId),
        setAllowed: (machineId, value) =>
          void (value ? allowed.add(machineId) : allowed.delete(machineId)),
      },
      () => clock,
    );

  beforeEach(async () => {
    db = openDatabase(":memory:");
    repo = new PortForwardsRepo(db);
    carrier = new FakeCarrier();
    allowed = new Set();
    clock = new Date("2026-09-19T08:00:00.000Z");
  });

  afterEach(() => {
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
      expect(inbound).toMatchObject({ direction: "in" });
      expect(outbound).toMatchObject({ direction: "out" });

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
      carrier = new FakeCarrier();
      carrier.connected = false;
      const after = service();
      await after.start();
      expect(carrier.wanted.get(MACHINE)).toHaveLength(2);
      expect(after.list().map((f) => f.status)).toEqual([
        { kind: "not-connected" },
        { kind: "not-connected" },
      ]);
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

  describe("an out forward is cleared first", () => {
    const outbound = {
      machineId: MACHINE,
      workspace: WORKSPACE,
      direction: "out" as const,
      remotePort: 5432,
      localPort: 5432,
    };

    it("is refused, naming why, when the machine's sshd would expose it or cannot be read — and carried when it keeps the loopback", async () => {
      const forwards = service();
      carrier.exposure = { mode: "exposes" };
      expect(await forwards.create(outbound)).toEqual({
        error: "exposure_refused",
        mode: "exposes",
      });
      expect(repo.all()).toHaveLength(0);
      // The verdict stands until the machine is asked again.
      carrier.exposure = { mode: "unknown", detail: "ssh exited 255" };
      expect(await forwards.create(outbound)).toEqual({
        error: "exposure_refused",
        mode: "exposes",
      });
      await forwards.probe(MACHINE);
      expect(await forwards.create(outbound)).toEqual({
        error: "exposure_refused",
        mode: "unknown",
      });
      carrier.exposure = { mode: "loopback" };
      expect(made(await forwards.create(outbound)).status).toEqual({ kind: "pending" });
      expect(carrier.wanted.get(MACHINE)).toEqual([
        { direction: "out", localPort: 5432, remotePort: 5432 },
      ]);
    });

    it("keeps a definite verdict for a while and never an unknown one", async () => {
      const forwards = service();
      carrier.exposure = { mode: "exposes" };
      await forwards.create(outbound);
      await forwards.create({ ...outbound, remotePort: 5433 });
      expect(carrier.probes).toBe(1);
      clock = new Date(clock.getTime() + 11 * 60_000);
      await forwards.create(outbound);
      expect(carrier.probes).toBe(2);
      carrier.exposure = { mode: "unknown", detail: "down" };
      await forwards.probe(MACHINE);
      await forwards.create(outbound);
      expect(carrier.probes).toBe(4);
    });

    it("holds back the out forwards on record — the in ones go — and hands them over on consent", async () => {
      // On record already (a build before, or consent since withdrawn), the machine now exposing.
      repo.insert({ id: "o1", ...outbound, createdAt: clock.toISOString() });
      repo.insert({
        id: "i1",
        machineId: MACHINE,
        workspace: WORKSPACE,
        direction: "in",
        remotePort: 3000,
        localPort: 3000,
        createdAt: clock.toISOString(),
      });
      carrier.exposure = { mode: "exposes" };
      const forwards = service();
      await forwards.start();
      expect(carrier.wanted.get(MACHINE)).toEqual([
        { direction: "in", localPort: 3000, remotePort: 3000 },
      ]);
      const byId = (id: string) => forwards.list().find((f) => f.id === id)!;
      expect(byId("o1").status).toEqual({ kind: "exposure-refused", mode: "exposes" });
      expect(byId("i1").status).toEqual({ kind: "pending" });
      expect(forwards.exposure()).toEqual([
        { machineId: MACHINE, alias: "build-box", allowed: false, exposure: { mode: "exposes" } },
      ]);

      // Consent: the whole set goes, and the page's row says so.
      expect(await forwards.setAllowed(MACHINE, true)).toMatchObject({ allowed: true });
      expect(carrier.wanted.get(MACHINE)).toEqual([
        { direction: "out", localPort: 5432, remotePort: 5432 },
        { direction: "in", localPort: 3000, remotePort: 3000 },
      ]);
      expect(byId("o1").status).toEqual({ kind: "pending" });
      // Withdrawn: held back again.
      await forwards.setAllowed(MACHINE, false);
      expect(carrier.wanted.get(MACHINE)).toEqual([
        { direction: "in", localPort: 3000, remotePort: 3000 },
      ]);
      expect(byId("o1").status).toEqual({ kind: "exposure-refused", mode: "exposes" });
      expect(await forwards.setAllowed("nobody", true)).toBeNull();
    });

    it("tries a machine that could not be read again from a read, once it is connected and a while has passed", async () => {
      repo.insert({ id: "o1", ...outbound, createdAt: clock.toISOString() });
      carrier.exposure = { mode: "unknown", detail: "down" };
      carrier.connected = false;
      const forwards = service();
      await forwards.start();
      expect(forwards.list()[0]!.status).toEqual({ kind: "exposure-refused", mode: "unknown" });
      // Up now, and answering: the next read after the wait hands it over.
      carrier.connected = true;
      carrier.exposure = { mode: "loopback" };
      forwards.list();
      expect(carrier.wanted.get(MACHINE)).toEqual([]);
      clock = new Date(clock.getTime() + 31_000);
      forwards.list();
      await new Promise((r) => setTimeout(r, 0));
      expect(carrier.wanted.get(MACHINE)).toEqual([
        { direction: "out", localPort: 5432, remotePort: 5432 },
      ]);
      expect(forwards.list()[0]!.status).toEqual({ kind: "pending" });
    });
  });
});
