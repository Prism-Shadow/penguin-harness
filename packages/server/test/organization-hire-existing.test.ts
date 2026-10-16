/**
 * Hiring an existing Agent through the organization service:
 * - An Agent with no employee plugins receives them before its desk is opened.
 * - A missing plugin is installed while carried plugins, custom plugins and AGENTS.md survive.
 * - An Agent already carrying the employee plugins is hired without reinstalling them.
 * - A failed plugin install leaves no employee, desk or join announcement; retry finishes the hire.
 * - A missing library plugin refuses the hire without assigning the Agent to the organization.
 * - A repeated hire is refused without changing the Agent or announcing another employee.
 * Plugin presence follows the Agent gateway: a non-null version can describe a partial copy,
 * which hiring must leave alone rather than overwrite the user's carried skills.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_ID } from "../src/organization/paths.js";
import { FAKE_LIBRARY_VERSION, makeOrgHarness } from "./org-harness.js";
import type { OrgHarness } from "./org-harness.js";

const ORG = "acme";
const CEO = "acme_ceo";
const AGENT = "existing_agent";
const REQUEST = { agentId: AGENT, title: "Engineer", reportsTo: CEO };
const BRIEF = "# Existing instructions\nKeep the project's own workflow.\n";
// A newer carried copy also proves that hiring does not downgrade customized versions.
const CARRIED_VERSION = "2099.01.01.1";

describe("hiring an existing Agent", () => {
  let h: OrgHarness;

  beforeEach(async () => {
    h = await makeOrgHarness({ nowMs: Date.parse("2026-09-01T01:00:00Z") });
    await h.service.create(
      h.projectId,
      { orgId: ORG, name: "Acme", mission: "Build tools", timezone: "UTC" },
      "alice",
    );
    h.agents.add(AGENT);
    h.briefs.set(AGENT, BRIEF);
  });

  const announcements = () =>
    h.service.channelMessages(h.projectId, ORG, { userId: "alice" }, DEFAULT_CHANNEL_ID, {});

  it("installs both employee plugins on an Agent that carries neither and opens its desk", async () => {
    const employee = await h.service.hire(h.projectId, ORG, REQUEST);

    expect(h.plugins.installed.get(`${AGENT}:agent-company`)).toBe(FAKE_LIBRARY_VERSION);
    expect(h.plugins.installed.get(`${AGENT}:agent-development`)).toBe(FAKE_LIBRARY_VERSION);
    expect(employee.desk?.sessionId).toBeDefined();
    expect(h.agentsCreated.map((agent) => agent.agentId)).toEqual([CEO]);
    expect(h.briefs.get(AGENT)).toBe(BRIEF);
  });

  it("installs only the missing plugin and preserves carried versions, custom plugins and instructions", async () => {
    // The gateway also reports a non-null version for a partially carried plugin.
    h.plugins.installed.set(`${AGENT}:agent-company`, CARRIED_VERSION);
    h.plugins.installed.set(`${AGENT}:custom-plugin`, "custom-version");

    await h.service.hire(h.projectId, ORG, REQUEST);

    expect(h.plugins.updated.filter((update) => update.agentId === AGENT)).toEqual([
      { agentId: AGENT, plugin: "agent-development" },
    ]);
    expect(h.plugins.installed.get(`${AGENT}:agent-company`)).toBe(CARRIED_VERSION);
    expect(h.plugins.installed.get(`${AGENT}:agent-development`)).toBe(FAKE_LIBRARY_VERSION);
    expect(h.plugins.installed.get(`${AGENT}:custom-plugin`)).toBe("custom-version");
    expect(h.briefs.get(AGENT)).toBe(BRIEF);
  });

  it("leaves already carried employee plugins untouched", async () => {
    h.plugins.installed.set(`${AGENT}:agent-company`, CARRIED_VERSION);
    h.plugins.installed.set(`${AGENT}:agent-development`, FAKE_LIBRARY_VERSION);
    const before = new Map(h.plugins.installed);

    await h.service.hire(h.projectId, ORG, REQUEST);

    expect(h.plugins.installed).toEqual(before);
    expect(h.plugins.updated).toEqual([]);
    expect(h.briefs.get(AGENT)).toBe(BRIEF);
  });

  it("does not assign or announce an employee after an install fails and can retry without reinstalling a successful plugin", async () => {
    h.plugins.failUpdates.add(`${AGENT}:agent-development`);
    h.plugins.installed.set(`${AGENT}:custom-plugin`, "custom-version");
    const before = await announcements();

    await expect(h.service.hire(h.projectId, ORG, REQUEST)).rejects.toThrow(
      "plugin agent-development could not be written",
    );

    expect((await h.service.chart(h.projectId, ORG)).employees.map((e) => e.agentId)).toEqual([
      CEO,
    ]);
    expect(h.created.filter((session) => session.agentId === AGENT)).toEqual([]);
    expect(await announcements()).toEqual(before);
    expect(h.briefs.get(AGENT)).toBe(BRIEF);
    expect(h.plugins.installed.get(`${AGENT}:custom-plugin`)).toBe("custom-version");

    h.plugins.failUpdates.clear();
    const employee = await h.service.hire(h.projectId, ORG, REQUEST);
    expect(employee.desk?.sessionId).toBeDefined();
    expect(h.plugins.updated.filter((update) => update.agentId === AGENT)).toEqual([
      { agentId: AGENT, plugin: "agent-company" },
      { agentId: AGENT, plugin: "agent-development" },
    ]);
  });

  it("refuses a hire when the required plugin is unavailable from the library", async () => {
    h.plugins.library.delete("agent-company");
    const before = await announcements();

    await expect(h.service.hire(h.projectId, ORG, REQUEST)).rejects.toThrow(
      "Plugin is not in the library: agent-company",
    );

    expect((await h.service.chart(h.projectId, ORG)).employees.map((e) => e.agentId)).toEqual([
      CEO,
    ]);
    expect(h.created.filter((session) => session.agentId === AGENT)).toEqual([]);
    expect(await announcements()).toEqual(before);
    expect(h.briefs.get(AGENT)).toBe(BRIEF);
  });

  it("refuses a repeated hire without changing plugins, instructions, desks or announcements", async () => {
    await h.service.hire(h.projectId, ORG, REQUEST);
    const installed = new Map(h.plugins.installed);
    const updates = [...h.plugins.updated];
    const created = [...h.created];
    const before = await announcements();

    await expect(h.service.hire(h.projectId, ORG, REQUEST)).rejects.toMatchObject({
      code: "employee_exists",
    });

    expect(h.plugins.installed).toEqual(installed);
    expect(h.plugins.updated).toEqual(updates);
    expect(h.created).toEqual(created);
    expect(await announcements()).toEqual(before);
    expect(h.briefs.get(AGENT)).toBe(BRIEF);
  });
});
