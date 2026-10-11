import { afterEach, describe, expect, it } from "vitest";
import {
  forgetOrgMachines,
  machineForOrg,
  machineForOrgPath,
  orgInPath,
  rememberOrgMachine,
  rememberSessionsIn,
} from "../src/lib/org-machines";
import { forgetSessionMachines, machineForSession } from "../src/lib/session-machines";

afterEach(() => {
  forgetOrgMachines();
  forgetSessionMachines();
});

describe("which machine an organization lives on", () => {
  it("routes every organization-scoped path to the machine it was last seen on", () => {
    rememberOrgMachine("p1", "acme", "m-remote");
    expect(machineForOrg("p1", "acme")).toBe("m-remote");
    for (const path of [
      "/api/projects/p1/organizations/acme",
      "/api/projects/p1/organizations/acme/chart",
      "/api/projects/p1/organizations/acme/tickets/T-1/start",
      "/api/projects/p1/organizations/acme/channels?limit=5",
    ]) {
      expect(machineForOrgPath(path)).toBe("m-remote");
    }
    // Another Project's organization of the same id is another organization.
    expect(machineForOrgPath("/api/projects/p2/organizations/acme")).toBeNull();
  });

  it("leaves the collection's own routes to the caller: they ask a server, not an organization", () => {
    rememberOrgMachine("p1", "suggest-id", "m-remote");
    expect(orgInPath("/api/projects/p1/organizations")).toBeNull();
    expect(orgInPath("/api/projects/p1/organizations/suggest-id")).toBeNull();
    expect(machineForOrgPath("/api/projects/p1/organizations/suggest-id")).toBeNull();
    expect(orgInPath("/api/projects/p%201/organizations/a%2Fb/chart")).toEqual({
      projectId: "p 1",
      orgId: "a/b",
    });
    expect(orgInPath("/api/sessions/s1")).toBeNull();
  });

  it("stores this server as absence, and forgets everything for a rebuilt listing", () => {
    rememberOrgMachine("p1", "acme", "m-remote");
    rememberOrgMachine("p1", "acme", null);
    expect(machineForOrg("p1", "acme")).toBeNull();
    rememberOrgMachine("p1", "acme", "m-remote");
    forgetOrgMachines();
    expect(machineForOrg("p1", "acme")).toBeNull();
  });

  it("records the Sessions an organization's answer names against the organization's machine", () => {
    rememberSessionsIn(
      {
        desks: [{ agentId: "ceo", sessionId: "desk-1" }],
        tickets: [{ ticketId: "T-1", sessions: [{ sessionId: "work-1" }, { sessionId: "" }] }],
        sessionId: "top-1",
        note: "sessionId",
      },
      "m-remote",
    );
    expect(machineForSession("desk-1")).toBe("m-remote");
    expect(machineForSession("work-1")).toBe("m-remote");
    expect(machineForSession("top-1")).toBe("m-remote");
    // This server's Sessions are absence already; nothing is recorded for them.
    rememberSessionsIn({ sessionId: "local-1" }, null);
    expect(machineForSession("local-1")).toBeNull();
  });
});
