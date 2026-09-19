/**
 * An organization lives on the machine its workspace is on, so the company store's listing is
 * a merge: this server's organizations plus those of every machine held for the Project —
 * each row saying where it is, and each organization's machine remembered so that the forty
 * organization-scoped calls route there without naming it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrganizationSummary } from "@prismshadow/penguin-server/api";

const listOrganizations = vi.fn();
const getMachines = vi.fn();
vi.mock("../src/api/endpoints", () => ({
  listOrganizations: (...args: unknown[]) => listOrganizations(...args),
  getMachines: (...args: unknown[]) => getMachines(...args),
}));

const { ApiError } = await import("../src/api/client");
const { createCompanyStore } = await import("../src/state/company");
const { forgetOrgMachines, machineForOrg } = await import("../src/lib/org-machines");

const org = (orgId: string, over: Partial<OrganizationSummary> = {}): OrganizationSummary =>
  ({
    projectId: "p1",
    orgId,
    name: orgId,
    mission: "",
    status: "active",
    ...over,
  }) as OrganizationSummary;

const machine = (machineId: string, alias: string, connected = true) => ({
  local: false,
  installed: { version: "1" },
  machineId,
  alias,
  connection: connected ? { since: "now" } : null,
});

afterEach(() => {
  forgetOrgMachines();
  listOrganizations.mockReset();
  getMachines.mockReset();
});

describe("the organization listing across machines", () => {
  it("merges this server's organizations with every held machine's, and remembers where each lives", async () => {
    getMachines.mockResolvedValue({
      machines: [
        machine("m-a", "gpu01"),
        machine("m-off", "laptop", false),
        { ...machine("self", "here"), local: true },
      ],
    });
    listOrganizations.mockImplementation(async (_p: string, machineId: string | null) => ({
      organizations: machineId === null ? [org("acme")] : [org("lab")],
    }));
    const store = createCompanyStore();
    await store.getState().reloadOrganizations(["p1"]);

    // Asked: this server and the one machine a connection is held to — not the offline one, not itself.
    expect(listOrganizations.mock.calls.map((c) => c[1])).toEqual([null, "m-a"]);
    const { organizations, orgsPartial } = store.getState();
    expect(organizations.map((o) => [o.orgId, o.machineId])).toEqual([
      ["acme", null],
      ["lab", "m-a"],
    ]);
    expect(orgsPartial).toBe(false);
    expect(machineForOrg("p1", "acme")).toBeNull();
    expect(machineForOrg("p1", "lab")).toBe("m-a");
  });

  it("reads a machine with company mode off as 'none there', and an unreachable one as a partial listing", async () => {
    getMachines.mockResolvedValue({
      machines: [machine("m-off-mode", "a"), machine("m-down", "b")],
    });
    listOrganizations.mockImplementation(async (_p: string, machineId: string | null) => {
      if (machineId === "m-off-mode")
        throw new ApiError(404, "not_found", "Endpoint does not exist.");
      if (machineId === "m-down") throw new ApiError(502, "bad_gateway", "tunnel is down");
      return { organizations: [org("acme")] };
    });
    const store = createCompanyStore();
    await store.getState().reloadOrganizations(["p1"]);
    expect(store.getState().organizations.map((o) => o.orgId)).toEqual(["acme"]);
    // Only the machine that could not be ASKED makes the list partial.
    expect(store.getState().orgsPartial).toBe(true);
  });

  it("keeps one organization per id — this server's — when two machines hold the same one", async () => {
    getMachines.mockResolvedValue({ machines: [machine("m-a", "gpu01")] });
    listOrganizations.mockResolvedValue({ organizations: [org("acme")] });
    const store = createCompanyStore();
    await store.getState().reloadOrganizations(["p1"]);
    expect(store.getState().organizations.map((o) => [o.orgId, o.machineId])).toEqual([
      ["acme", null],
    ]);
    expect(machineForOrg("p1", "acme")).toBeNull();
  });

  it("is this server's listing alone for a reader who cannot see the machine list", async () => {
    getMachines.mockRejectedValue(new ApiError(403, "forbidden", "admin only"));
    listOrganizations.mockResolvedValue({ organizations: [org("acme")] });
    const store = createCompanyStore();
    await store.getState().reloadOrganizations(["p1"]);
    expect(listOrganizations).toHaveBeenCalledTimes(1);
    expect(store.getState().organizations).toHaveLength(1);
    expect(store.getState().orgsPartial).toBe(false);
  });
});
