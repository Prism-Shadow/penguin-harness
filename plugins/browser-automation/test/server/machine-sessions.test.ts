/**
 * Which machine holds a Session this server does not, as the browser routes ask it: the machines
 * of the Project answer for their own Sessions.
 *
 * - The machine that answers with the Session in that Project holds it.
 * - A machine that holds the Session in another Project does not count, nor one that refuses or
 *   does not answer, nor one not connected; when `named`, only that machine is asked.
 */
import { describe, expect, it } from "vitest";
import { machineHolding } from "../../src/server/machine-sessions.js";
import type { ProjectMachineApis } from "../../src/server/machine-sessions.js";

/** A machine that holds the given Sessions (id → its Project), and the paths it was asked. */
function machine(held: Record<string, string>, asked: string[], fails = false) {
  return {
    async request(_method: string, path: string) {
      asked.push(path);
      if (fails) throw new Error("socket hang up");
      const id = decodeURIComponent(path.slice("/api/sessions/".length));
      const projectId = held[id];
      return projectId === undefined
        ? { status: 404, text: '{"error":{"code":"session_not_found"}}' }
        : { status: 200, text: JSON.stringify({ session: { sessionId: id, projectId } }) };
    },
  };
}

describe("which machine holds a Session", () => {
  it("is the one that answers with it in the Project asked about", async () => {
    const asked: string[] = [];
    const machines: ProjectMachineApis = async () => [
      { machineId: "offline", api: null },
      { machineId: "broken", api: machine({}, asked, true) },
      { machineId: "elsewhere", api: machine({ "s-1": "other" }, asked) },
      { machineId: "gpu", api: machine({ "s-1": "work" }, asked) },
    ];
    expect(await machineHolding(machines, "work", "s-1")).toBe("gpu");
    expect(await machineHolding(machines, "work", "s-2")).toBeNull();
  });

  it("asks only the machine named", async () => {
    const asked: string[] = [];
    const machines: ProjectMachineApis = async () => [
      { machineId: "gpu", api: machine({ "s-1": "work" }, asked) },
      { machineId: "build", api: machine({ "s-1": "work" }, asked) },
    ];
    expect(await machineHolding(machines, "work", "s-1", "build")).toBe("build");
    expect(asked).toEqual(["/api/sessions/s-1"]);
    expect(await machineHolding(machines, "work", "s-1", "missing")).toBeNull();
  });
});
