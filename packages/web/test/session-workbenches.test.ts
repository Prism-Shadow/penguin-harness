import { describe, expect, it } from "vitest";
import {
  parseSessionWorkbenchPage,
  sessionWorkbenchPage,
  sessionWorkbenchPath,
} from "../src/lib/session-workbenches";

describe("the address of a Session workbench", () => {
  it("keeps the host, Project and Session explicit even when two machines use the same identifiers", () => {
    const local = { projectId: "p", sessionId: "s", machineId: null };
    const work = (
      scope: typeof local | { projectId: string; sessionId: string; machineId: string },
    ) => sessionWorkbenchPage("workspace", scope, "Files");
    const remote = { ...local, machineId: "machine-a" };
    expect(work(local).id).not.toBe(work(remote).id);
    expect(work(local).id).not.toBe(work({ ...local, projectId: "other" }).id);
    expect(parseSessionWorkbenchPage(work(remote))).toEqual({ kind: "workspace", address: remote });
    expect(parseSessionWorkbenchPage({ path: "/session-tools/agents?session=unknown" })).toBeNull();
  });
  it("requires a Session choice for a directory address", () => {
    expect(parseSessionWorkbenchPage({ path: sessionWorkbenchPath("terminal") })).toBeNull();
  });
});
