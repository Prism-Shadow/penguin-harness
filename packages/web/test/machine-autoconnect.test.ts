/**
 * Auto-connecting to a machine the first time something needs it. The cases pin the
 * schedule (doubling, then giving up), the once-per-machine memory, and the one reading
 * that matters: "connected" is the machine list's word after the job settles, not the
 * job's own verdict.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { MachineInfo, MachinesResponse } from "@prismshadow/penguin-server/api";
import {
  AUTO_CONNECT_STEPS_MS,
  autoConnectDelayMs,
  ensureMachineConnected,
  forgetAutoConnects,
  onMachineAutoConnected,
} from "../src/lib/machine-autoconnect";

const REMOTE = "kUkIyqU-1GOfXgKD";

const nas = (over: Partial<MachineInfo> = {}): MachineInfo => ({
  id: "ssh:nas",
  alias: "nas",
  installed: { version: "1.0.0", at: "2026-08-01T00:00:00.000Z" },
  machineId: REMOTE,
  local: false,
  connected: false,
  status: null,
  ...over,
});

const response = (machines: MachineInfo[], job: MachinesResponse["job"] = null) => ({
  machines,
  imageVersion: "1.0.0",
  job,
});

/** A fake server: connect flips the machine to connected after one poll, unless told to fail. */
function fakeApi(
  opts: { connects: "ok" | "fail" | "throw"; listed?: boolean } = { connects: "ok" },
) {
  const calls: string[] = [];
  let connected = false;
  let running = false;
  const api = {
    async getMachines() {
      calls.push("list");
      const wasRunning = running;
      running = false;
      const machine = nas({ connected });
      return response(
        opts.listed === false ? [] : [machine],
        wasRunning
          ? {
              kind: "connect",
              machineId: "ssh:nas",
              alias: "nas",
              running: false,
              log: [],
              result: null,
            }
          : null,
      );
    },
    async connectMachine(_projectId: string, address: string) {
      calls.push(`connect:${address}`);
      if (opts.connects === "throw") throw new Error("409 connect_running");
      running = true;
      if (opts.connects === "ok") connected = true;
      return response([nas()], {
        kind: "connect",
        machineId: address,
        alias: "nas",
        running: true,
        log: [],
        result: null,
      });
    },
  };
  return { api, calls };
}

const sleeps: number[] = [];
const sleep = async (ms: number) => {
  sleeps.push(ms);
};

afterEach(() => {
  forgetAutoConnects();
  sleeps.length = 0;
});

describe("the schedule", () => {
  it("doubles from two seconds and gives up after the last step", () => {
    expect(autoConnectDelayMs(1)).toBe(2_000);
    expect(autoConnectDelayMs(2)).toBe(4_000);
    expect(autoConnectDelayMs(AUTO_CONNECT_STEPS_MS.length)).toBe(64_000);
    expect(autoConnectDelayMs(AUTO_CONNECT_STEPS_MS.length + 1)).toBeNull();
  });
});

describe("connecting on first need", () => {
  it("connects an installed machine and reports it connected", async () => {
    const { api, calls } = fakeApi();
    await expect(ensureMachineConnected("p", REMOTE, { api, sleep })).resolves.toBe("connected");
    expect(calls).toEqual(["list", "connect:ssh:nas", "list"]);
    expect(sleeps).toEqual([]);
  });

  it("does nothing to a machine that is already connected", async () => {
    const api = {
      async getMachines() {
        return response([nas({ connected: true })]);
      },
      async connectMachine(): Promise<MachinesResponse> {
        throw new Error("must not be called");
      },
    };
    await expect(ensureMachineConnected("p", REMOTE, { api, sleep })).resolves.toBe("connected");
  });

  it("retries on the widening schedule and then gives up", async () => {
    const { api, calls } = fakeApi({ connects: "fail" });
    await expect(ensureMachineConnected("p", REMOTE, { api, sleep })).resolves.toBe("gave-up");
    expect(sleeps).toEqual([...AUTO_CONNECT_STEPS_MS]);
    expect(calls.filter((c) => c.startsWith("connect:"))).toHaveLength(
      AUTO_CONNECT_STEPS_MS.length + 1,
    );
  });

  it("a refused POST (another job running) is a retry, not an error", async () => {
    const { api } = fakeApi({ connects: "throw" });
    await expect(ensureMachineConnected("p", REMOTE, { api, sleep })).resolves.toBe("gave-up");
    expect(sleeps.length).toBe(AUTO_CONNECT_STEPS_MS.length);
  });

  it("waits out a job already running before asking", async () => {
    let polls = 0;
    const api = {
      async getMachines() {
        polls += 1;
        return response(
          [nas({ connected: polls > 2 })],
          polls <= 2
            ? {
                kind: "install",
                machineId: "ssh:other",
                alias: "other",
                running: true,
                log: [],
                result: null,
              }
            : null,
        );
      },
      async connectMachine(): Promise<MachinesResponse> {
        throw new Error("must not be called — it came up on its own");
      },
    };
    await expect(ensureMachineConnected("p", REMOTE, { api, sleep, pollMs: 7 })).resolves.toBe(
      "connected",
    );
    expect(sleeps).toEqual([7, 7]);
  });

  it("a machine the list does not carry is unknown, not unreachable", async () => {
    const { api } = fakeApi({ connects: "ok", listed: false });
    // An empty list reads as "could not ask", so it retries; make the list non-empty instead.
    const other = {
      async getMachines() {
        return response([nas({ machineId: "someone-else" })]);
      },
      connectMachine: api.connectMachine,
    };
    await expect(ensureMachineConnected("p", REMOTE, { api: other, sleep })).resolves.toBe(
      "unknown-machine",
    );
  });
});

describe("once per machine", () => {
  it("a second need joins the first attempt instead of starting another", async () => {
    const { api, calls } = fakeApi();
    const first = ensureMachineConnected("p", REMOTE, { api, sleep });
    const second = ensureMachineConnected("p", REMOTE, { api, sleep });
    expect(second).toBe(first);
    await first;
    expect(calls.filter((c) => c.startsWith("connect:"))).toHaveLength(1);
  });

  it("a machine that dropped is connected again by the next need — the drop is not final", async () => {
    // The regression this guards: "connected" used to be remembered like a failure, so a
    // forward that died (ssh, the network, a reboot) was never raised again for the life of
    // the page. Every later need — the not_connected retry in api/client.ts above all — was
    // answered "already connected" by the cache while nothing was listening on the far end.
    const { api, calls } = fakeApi();
    await expect(ensureMachineConnected("p", REMOTE, { api, sleep })).resolves.toBe("connected");
    const connects = () => calls.filter((c) => c.startsWith("connect:")).length;
    expect(connects()).toBe(1);
    // The forward dies: the machine lists itself unconnected again.
    const dropped = fakeApi();
    await expect(ensureMachineConnected("p", REMOTE, { api: dropped.api, sleep })).resolves.toBe(
      "connected",
    );
    expect(dropped.calls.filter((c) => c.startsWith("connect:"))).toHaveLength(1);
  });

  it("a settled outcome is kept: a machine that gave up is not re-tried by the next pick", async () => {
    const { api, calls } = fakeApi({ connects: "fail" });
    await ensureMachineConnected("p", REMOTE, { api, sleep });
    const before = calls.length;
    await expect(ensureMachineConnected("p", REMOTE, { api, sleep })).resolves.toBe("gave-up");
    expect(calls.length).toBe(before);
  });

  it("tells its listeners when a machine comes up", async () => {
    const { api } = fakeApi();
    const seen: string[] = [];
    const off = onMachineAutoConnected((projectId, machineId) =>
      seen.push(`${projectId}/${machineId}`),
    );
    await ensureMachineConnected("p", REMOTE, { api, sleep });
    off();
    expect(seen).toEqual([`p/${REMOTE}`]);
  });
});
