/**
 * How a surface outside the Machines page reads a machine by its own id (lib/machine-link.ts):
 * the composer asks a machine's Agents only while it is connected, and says why otherwise.
 *
 * - Given the machine list, a connected machine is connected; one the server is bringing back is
 *   reconnecting even while its ssh connection is still up, and one it stopped bringing back says
 *   so; an installed one not connected is stopped; one on the list with nothing installed is not
 *   connected.
 * - Given an id the list does not hold, it is missing — once the list has answered; before that
 *   the answer is unknown, not a verdict.
 * - This server's own entry never stands for a machine id.
 * - The composer's Agent picker says why it has nothing to offer in those words: a machine coming
 *   back, no longer coming back on its own (the Machines page retries it), stopped, not set up or
 *   not on the list — never "not connected" for a machine that is connected and answered with a
 *   failure, whose own words it gives instead.
 * - A conversation's restart notice stands for its machine while that machine is connected and
 *   its server never takes the API socket — read as the machine's card reads it, so not while the
 *   server is bringing it back (the away reading speaks then), not once a handshake completed,
 *   and not before the list has answered.
 */
import { describe, expect, it } from "vitest";
import type { MachineInfo, MachinesResponse } from "@prismshadow/penguin-server/api";
import { machineRestartNeeded } from "../src/features/chat/machine-away";
import { machineLink, remoteAgentsEmpty } from "../src/lib/machine-link";
import { S } from "../src/lib/strings";

const machine = (machineId: string, over: Partial<MachineInfo> = {}): MachineInfo => ({
  id: `ssh:${machineId}`,
  alias: machineId,
  machineId,
  installed: { version: "0.2.13", at: "2026-10-01T08:00:00.000Z" },
  local: false,
  connection: null,
  socket: null,
  api: null,
  status: null,
  root: "$HOME/.penguin/data",
  ...over,
});
const list = (...machines: MachineInfo[]): MachinesResponse => ({
  machines,
  imageVersion: "0.2.13",
  job: null,
  jobs: [],
});

describe("a machine as other surfaces read it", () => {
  it("is connected while its connection is held and nothing is being brought back", () => {
    expect(machineLink(list(machine("a", { connection: { pid: 1 } })), true, "a")).toBe(
      "connected",
    );
  });

  it("is reconnecting while the server brings it back, even with its ssh connection still up, and says when it stopped", () => {
    const back = machine("a", {
      connection: { pid: 1 },
      reconnect: {
        since: "2026-10-10T08:00:00.000Z",
        attempts: 1,
        maxAttempts: 8,
        nextAt: null,
        lastError: null,
        diagnosis: null,
      },
    });
    expect(machineLink(list(back), true, "a")).toBe("reconnecting");
    const stopped = machine("a", {
      reconnect: { ...back.reconnect!, attempts: 8, gaveUp: "attempts" },
    });
    expect(machineLink(list(stopped), true, "a")).toBe("reconnectStopped");
  });

  it("is stopped when installed and not connected, and not connected with nothing installed", () => {
    expect(machineLink(list(machine("a")), true, "a")).toBe("stopped");
    expect(machineLink(list(machine("a", { installed: null })), true, "a")).toBe("notConnected");
  });

  it("is missing when the answered list does not hold it, and unknown before the list answers", () => {
    expect(machineLink(list(machine("a")), true, "gone")).toBe("missing");
    expect(machineLink(null, true, "a")).toBe("missing");
    expect(machineLink(null, false, "a")).toBe("unknown");
  });

  it("never takes this server's own entry for a machine", () => {
    const here = machine("a", { id: "local", local: true, connection: null });
    expect(machineLink(list(here), true, "a")).toBe("missing");
  });
});

describe("the composer's Agent picker with nothing to offer", () => {
  const c = S.machines.composer;

  it("says the machine's own state, the one the Machines page shows", () => {
    expect(remoteAgentsEmpty("reconnecting", null)).toBe(c.reconnecting);
    expect(remoteAgentsEmpty("reconnectStopped", null)).toBe(c.reconnectStopped);
    expect(remoteAgentsEmpty("stopped", null)).toBe(c.stopped);
    expect(remoteAgentsEmpty("notConnected", null)).toBe(c.notConnected);
    expect(remoteAgentsEmpty("missing", null)).toBe(c.missing);
  });

  it("gives a connected machine's own failure, and is loading while it is asked", () => {
    expect(remoteAgentsEmpty("connected", "project not found")).toBe(c.failed("project not found"));
    expect(remoteAgentsEmpty("connected", null)).toBe(S.common.loading);
    expect(remoteAgentsEmpty(null, null)).toBe(S.common.loading);
    expect(remoteAgentsEmpty("unknown", null)).toBe(S.common.loading);
  });
});

describe("a conversation's restart notice", () => {
  const since = "2026-10-26T08:00:00.000Z";
  const held = { connection: { pid: 1 } };

  it("stands for the machine while it is connected and its server never takes the socket", () => {
    const box = machine("a", { ...held, socket: { state: "unanswered", since } });
    expect(machineRestartNeeded(list(box), "a")).toBe(box);
  });

  it("is nothing once a handshake completed, while the machine is being brought back, or before the list answered", () => {
    const restarted = machine("a", { ...held, socket: { state: "connected", since } });
    expect(machineRestartNeeded(list(restarted), "a")).toBeNull();
    const away = machine("a", {
      ...held,
      socket: { state: "unanswered", since },
      reconnect: {
        since,
        attempts: 1,
        maxAttempts: 8,
        nextAt: null,
        lastError: null,
        diagnosis: null,
      },
    });
    expect(machineRestartNeeded(list(away), "a")).toBeNull();
    expect(machineRestartNeeded(null, "a")).toBeNull();
  });
});
