// @vitest-environment jsdom
/**
 * Deleting an organization from its settings (features/company/org-dialogs.tsx) and hiring into
 * one (features/company/employee-dialogs.tsx), beside the Agents page, whose delete buttons read
 * every Agent's employments off the Project's Agent list (state/project.tsx).
 *
 * - When the delete's confirmation opens, the Agent list is read again, and the confirmation
 *   names the Agents that would be deleted for good and those kept with their reason (another
 *   organization employs it too, it is built in), under a checkbox that is on.
 * - Confirmed with the box on, the organization goes with its Agents, and they leave the Agents
 *   page at once; the Agent another organization employs stays there, still undeletable.
 * - Confirmed with the box off, only the organization goes, and the Agents page turns its former
 *   employee's delete button on at once, without a reload.
 * - An Agent the server could not delete with its organization is named in an error toast.
 * - After a hire of a new Agent, the Agents page lists it at once, as an employee whose delete
 *   is off.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h, Fragment, useState } from "react";
import type { OrgEmployeeItem } from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentsPage } from "../src/features/agents/agents-page";
import { OrganizationSettingsDialog } from "../src/features/company/org-dialogs";
import { HireDialog } from "../src/features/company/employee-dialogs";
import { CompanyProvider } from "../src/state/company";
import { ThemeProvider } from "../src/state/theme";
import {
  PROJECT_ID,
  agentServer,
  buttonIn,
  fieldIn,
  mountAgentApp,
  topDialog,
} from "./helpers/agent-app";
import type { FakeOrganization } from "./helpers/agent-app";
import { button, click, field, type, unmountAll, waitFor } from "./helpers/dom";

const ACME: FakeOrganization = {
  orgId: "acme",
  name: "Acme",
  employees: [
    { agentId: "acme_ceo", title: "CEO" },
    { agentId: "acme_dev", title: "Developer" },
    { agentId: "shared_writer", title: "Writer" },
    { agentId: "default_agent", title: "Assistant" },
  ],
};
const NORTH: FakeOrganization = {
  orgId: "north",
  name: "North",
  employees: [
    { agentId: "north_ceo", title: "CEO" },
    { agentId: "shared_writer", title: "Editor" },
  ],
};

const agentsPath = `/api/projects/${PROJECT_ID}/agents`;

/** The Agents page's card of `agentId` (its name is its id here), or undefined when it is not listed. */
function cardOf(agentId: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(".ui-frame")].find(
    (card) => card.querySelector("a")?.textContent === agentId,
  );
}

/** That card's delete button. */
function deleteButtonOf(agentId: string): HTMLButtonElement {
  const found = cardOf(agentId)?.querySelector<HTMLButtonElement>(
    `button[aria-label="${en.agent.deleteAgent}"]`,
  );
  if (found == null) throw new Error(`no delete button on ${agentId}'s card`);
  return found;
}

/** The Agents page with the organization's settings open beside it, as the switcher opens them. */
function SettingsBeside() {
  const [open, setOpen] = useState(true);
  return h(
    Fragment,
    null,
    h(AgentsPage),
    h(OrganizationSettingsDialog, {
      open,
      projectId: PROJECT_ID,
      orgId: "acme",
      onClose: () => setOpen(false),
      onChanged: () => {},
    }),
  );
}

async function openSettings(organizations: FakeOrganization[] = [ACME, NORTH]) {
  const server = agentServer(undefined, { organizations });
  await mountAgentApp(h(SettingsBeside), { route: "/list", at: "/list" });
  await waitFor(() => cardOf("acme_dev") !== undefined);
  await waitFor(() => field(en.company.displayName).value === "Acme");
  return server;
}

const agentListReads = (server: ReturnType<typeof agentServer>) =>
  server.fetch.requests.filter((r) => r.method === "GET" && r.path === agentsPath).length;

/** Opens the delete confirmation and waits for the Agents it names. */
async function openDeleteConfirmation(server: ReturnType<typeof agentServer>) {
  const before = agentListReads(server);
  await click(buttonIn(topDialog(), en.common.delete));
  await waitFor(() => topDialog().textContent?.includes("acme_dev") === true);
  return { reads: agentListReads(server) - before };
}

const checkbox = () => topDialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!;

async function confirmDelete() {
  await type(fieldIn(topDialog(), en.company.deleteOrgTypeId("acme")), "acme");
  await click(buttonIn(topDialog(), en.common.delete));
}

const orgDeletes = (server: ReturnType<typeof agentServer>) =>
  server.fetch.requests.filter(
    (r) => r.method === "DELETE" && r.path === `/api/projects/${PROJECT_ID}/organizations/acme`,
  );

describe("deleting an organization beside the Agents page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    toastStore.setState({ items: [] });
  });

  it("names the Agents it deletes and keeps from a list read when the confirmation opens, the box on", async () => {
    const server = await openSettings();
    const { reads } = await openDeleteConfirmation(server);

    expect(reads).toBeGreaterThan(0);
    expect(checkbox().checked).toBe(true);
    const text = topDialog().textContent ?? "";
    expect(text).toContain(en.company.deleteOrgWillDelete("acme_ceo, acme_dev"));
    expect(text).toContain(
      en.company.deleteOrgWillKeep(
        `${en.company.deleteOrgKeptElsewhere("shared_writer", "North")}, ${en.company.deleteOrgKeptBuiltin("default_agent")}`,
      ),
    );
  });

  it("deletes the organization with its Agents, which leave the Agents page at once", async () => {
    const server = await openSettings();
    await openDeleteConfirmation(server);
    await confirmDelete();

    await waitFor(() => cardOf("acme_dev") === undefined);
    expect(orgDeletes(server).map((r) => r.query.get("deleteAgents"))).toEqual(["1"]);
    expect(cardOf("acme_ceo")).toBeUndefined();
    expect(deleteButtonOf("shared_writer").disabled).toBe(true);
  });

  it("with the box off deletes only the organization, and its former employee turns deletable at once", async () => {
    const server = await openSettings();
    expect(deleteButtonOf("acme_dev").disabled).toBe(true);
    await openDeleteConfirmation(server);
    await click(checkbox());
    await confirmDelete();

    await waitFor(() => !deleteButtonOf("acme_dev").disabled);
    expect(orgDeletes(server).map((r) => r.query.get("deleteAgents"))).toEqual([null]);
    expect(deleteButtonOf("acme_ceo").disabled).toBe(false);
    expect(deleteButtonOf("shared_writer").disabled).toBe(true);
  });

  it("names an Agent the server could not delete in an error toast", async () => {
    const stuck: FakeOrganization = {
      ...ACME,
      employees: ACME.employees.map((e) => (e.agentId === "acme_dev" ? { ...e, busy: true } : e)),
    };
    const server = await openSettings([stuck, NORTH]);
    await openDeleteConfirmation(server);
    await confirmDelete();

    await waitFor(() => toastStore.getState().items.length > 0);
    const [toast] = toastStore.getState().items;
    expect(toast?.kind).toBe("error");
    expect(toast?.text).toContain("acme_dev");
    expect(cardOf("acme_ceo")).toBeUndefined();
    expect(cardOf("acme_dev")).toBeDefined();
  });
});

const CEO: OrgEmployeeItem = {
  agentId: "acme_ceo",
  name: "acme_ceo",
  title: "CEO",
  reportsTo: null,
  workspace: "ceo",
  state: "idle",
  spend: { own: 0, cumulative: 0 },
};

/** The Agents page with the hire dialog open beside it, inside the company shell the chart gives it. */
function HireBeside() {
  return h(
    ThemeProvider,
    null,
    h(
      CompanyProvider,
      null,
      h(AgentsPage),
      h(HireDialog, {
        open: true,
        projectId: PROJECT_ID,
        orgId: "acme",
        manager: CEO,
        employees: [CEO],
        onClose: () => {},
        onHired: () => {},
      }),
    ),
  );
}

describe("hiring beside the Agents page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    toastStore.setState({ items: [] });
  });

  it("lists a newly hired Agent at once, as an employee whose delete is off", async () => {
    const server = agentServer(undefined, {
      organizations: [
        { orgId: "acme", name: "Acme", employees: [{ agentId: "acme_ceo", title: "CEO" }] },
      ],
    });
    await mountAgentApp(h(HireBeside), { route: "/list", at: "/list" });
    await waitFor(() => cardOf("acme_ceo") !== undefined);
    // The new-Agent half, which the dialog may already be on.
    await click(button(en.company.chart.hireNew));
    await type(field(en.company.chart.agentId), "writer");
    await type(field(en.company.chart.employeeTitle), "Docs engineer");
    await click(buttonIn(topDialog(), en.company.chart.hire));

    await waitFor(() => cardOf("writer") !== undefined);
    expect(server.writes(`/api/projects/${PROJECT_ID}/organizations/acme/employees`)).toHaveLength(
      1,
    );
    expect(deleteButtonOf("writer").disabled).toBe(true);
  });
});
