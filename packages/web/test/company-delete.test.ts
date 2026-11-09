// @vitest-environment jsdom
/**
 * Deleting an organization from its settings (features/company/org-dialogs.tsx), creating one,
 * hiring into one (features/company/employee-dialogs.tsx) and leaving one (the org chart's
 * menu), beside the Agents page, whose delete buttons read every Agent's employments off the
 * Project's Agent list (state/project.tsx).
 *
 * - When the delete's confirmation opens, the Agent list is read again, and the confirmation
 *   names the Agents that would be deleted for good and those kept with their reason (another
 *   organization employs it too, it is built in), under a checkbox that is on.
 * - Until that list has arrived the delete cannot be confirmed and the box is off; once it
 *   arrives the box is on.
 * - When that list cannot be read, the box stays off and the delete of the organization alone
 *   can still be confirmed; Retry reads the list again and turns the box on.
 * - Confirmed with the box on, the organization goes with the Agents it listed, and they leave
 *   the Agents page at once; the Agent another organization employs stays there, undeletable.
 * - An employee hired after the confirmation read the list is kept, and the toast names it.
 * - Confirmed with the box off, only the organization goes, and the Agents page turns its former
 *   employee's delete button on at once, without a reload.
 * - While another organization's chart cannot be read, the confirmation says so and lists every
 *   employee as kept, and nobody is deleted; a chart that breaks after the list was read keeps
 *   them too, and the toast says it was that organization's chart.
 * - While the delete runs, Esc does not close the confirmation.
 * - When the delete's answer is lost after the organization went, the dialog still leaves it as
 *   a delete does, and the Agent list is read again.
 * - An Agent the server could not delete with its organization is named in an error toast.
 * - After a hire of a new Agent, the Agents page lists it at once, as an employee whose delete
 *   is off; after a leave, the former employee's delete button turns on at once; after a
 *   creation, the new CEO's Agent is listed at once, as an employee.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h, Fragment, useState } from "react";
import type { OrgEmployeeItem } from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentsPage } from "../src/features/agents/agents-page";
import {
  CreateOrganizationDialog,
  OrganizationSettingsDialog,
} from "../src/features/company/org-dialogs";
import { HireDialog } from "../src/features/company/employee-dialogs";
import { OrgChartPage } from "../src/features/company/org-chart-page";
import { OrgContext } from "../src/features/company/org-layout";
import { CompanyProvider } from "../src/features/company/company-state";
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
import { button, click, field, pressEscape, type, unmountAll, waitFor } from "./helpers/dom";

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
/** The Agent list's own read, and nothing under it. */
const agentListRead = new RegExp(`^${agentsPath}$`);

/** The Agents page's card named `name` (an employee's name is its id here), or undefined when it is not listed. */
function cardOf(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(".ui-frame")].find(
    (card) => card.querySelector("a")?.textContent === name,
  );
}

/** Whether the org chart shows `agentId`'s personnel menu. */
const hasMenuOf = (agentId: string) =>
  document.querySelector(`button[aria-label="${agentId} · ${en.company.chart.nodeMenu}"]`) !== null;

/** That card's delete button. */
function deleteButtonOf(name: string): HTMLButtonElement {
  const found = cardOf(name)?.querySelector<HTMLButtonElement>(
    `button[aria-label="${en.agent.deleteAgent}"]`,
  );
  if (found == null) throw new Error(`no delete button on ${name}'s card`);
  return found;
}

/** The Agents page with the organization's settings open beside it, as the switcher opens them. */
function SettingsBeside({ onDeleted }: { onDeleted: () => void }) {
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
      onDeleted,
    }),
  );
}

async function openSettings(
  organizations: FakeOrganization[] = [ACME, NORTH],
  onDeleted: () => void = () => {},
) {
  const server = agentServer(undefined, { organizations });
  await mountAgentApp(h(SettingsBeside, { onDeleted }), { route: "/list", at: "/list" });
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
const confirmButton = () => buttonIn(topDialog(), en.common.delete);

async function typeOrgId() {
  await type(fieldIn(topDialog(), en.company.deleteOrgTypeId("acme")), "acme");
}

async function confirmDelete() {
  await typeOrgId();
  await click(confirmButton());
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

  it("holds the delete until the Agent list has arrived, then turns the box on", async () => {
    const server = await openSettings();
    const read = server.holdNext(null, agentListRead);
    await click(buttonIn(topDialog(), en.common.delete));
    await typeOrgId();

    expect(confirmButton().disabled).toBe(true);
    expect(checkbox().checked).toBe(false);
    expect(checkbox().disabled).toBe(true);
    read.release();
    await waitFor(() => checkbox().checked);
    expect(confirmButton().disabled).toBe(false);
  });

  it("keeps the box off after a failed read, lets the organization alone go, and retries the read", async () => {
    const server = await openSettings();
    server.failNext(null, agentListRead);
    await click(buttonIn(topDialog(), en.common.delete));
    await waitFor(() => topDialog().textContent?.includes(en.common.retry) === true);
    await typeOrgId();

    expect(checkbox().checked).toBe(false);
    expect(checkbox().disabled).toBe(true);
    expect(confirmButton().disabled).toBe(false);
    await click(buttonIn(topDialog(), en.common.retry));
    await waitFor(() => checkbox().checked);
    expect(topDialog().textContent).toContain("acme_dev");
  });

  it("deletes the organization with the Agents it listed, which leave the Agents page at once", async () => {
    const server = await openSettings();
    await openDeleteConfirmation(server);
    await confirmDelete();

    await waitFor(() => cardOf("acme_dev") === undefined);
    expect(
      orgDeletes(server).map((r) => [r.query.get("deleteAgents"), r.query.get("agentIds")]),
    ).toEqual([["1", "acme_ceo,acme_dev"]]);
    expect(cardOf("acme_ceo")).toBeUndefined();
    expect(deleteButtonOf("shared_writer").disabled).toBe(true);
  });

  it("keeps an employee hired after the list was read, and names it in the toast", async () => {
    const server = await openSettings();
    await openDeleteConfirmation(server);
    // Meanwhile the CEO hires the Project's own Agent from its desk.
    await fetch(`/api/projects/${PROJECT_ID}/organizations/acme/employees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "helper", title: "Intern", reportsTo: "acme_ceo" }),
    });
    await confirmDelete();

    await waitFor(() => toastStore.getState().items.length > 0);
    const [toast] = toastStore.getState().items;
    expect(toast?.kind).toBe("success");
    expect(toast?.text).toContain("Helper");
    expect(cardOf("acme_dev")).toBeUndefined();
    expect(server.localAgents()).toContain("helper");
    // Its card names it by its display name, and its delete is back on.
    expect(deleteButtonOf("Helper").disabled).toBe(false);
  });

  it("says beforehand that another organization's chart cannot be read, and deletes nobody", async () => {
    const server = await openSettings([ACME, { ...NORTH, chartUnreadable: true }]);
    await openDeleteConfirmation(server);

    const text = topDialog().textContent ?? "";
    expect(text).toContain(en.company.deleteOrgChartUnreadable("North"));
    expect(text).not.toContain(en.company.deleteOrgWillDelete("acme_ceo, acme_dev"));
    await confirmDelete();

    await waitFor(() => orgDeletes(server).length === 1);
    expect(orgDeletes(server)[0]!.query.get("agentIds")).toBe("");
    await waitFor(() => !deleteButtonOf("acme_dev").disabled);
    expect(server.localAgents()).toEqual(
      expect.arrayContaining(["acme_ceo", "acme_dev", "shared_writer"]),
    );
  });

  it("names the unreadable chart in the toast when it broke after the list was read", async () => {
    const server = await openSettings();
    await openDeleteConfirmation(server);
    server.setChartUnreadable("north", true);
    await confirmDelete();

    await waitFor(() => toastStore.getState().items.length > 0);
    const [toast] = toastStore.getState().items;
    expect(toast?.text).toContain(
      en.company.deleteOrgKeptUnreadableAfterAll("acme_ceo, acme_dev", "North"),
    );
    expect(server.localAgents()).toEqual(expect.arrayContaining(["acme_ceo", "acme_dev"]));
  });

  it("leaves the organization when the delete's answer is lost after it went", async () => {
    const onDeleted = vi.fn();
    const server = await openSettings([{ ...ACME, answerLost: true }, NORTH], onDeleted);
    await openDeleteConfirmation(server);
    await confirmDelete();

    await waitFor(() => onDeleted.mock.calls.length === 1);
    await waitFor(() => cardOf("acme_dev") === undefined);
    expect(cardOf("acme_ceo")).toBeUndefined();
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("does not close the confirmation on Esc while the delete runs", async () => {
    const server = await openSettings();
    await openDeleteConfirmation(server);
    server.hold();
    await confirmDelete();
    await pressEscape();

    expect(checkbox()).not.toBeNull();
    expect(cardOf("acme_dev")).toBeDefined();
    server.release();
    await waitFor(() => cardOf("acme_dev") === undefined);
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

/** The Agents page with the org chart beside it, as the organization's route mounts it. */
function ChartBeside() {
  return h(
    ThemeProvider,
    null,
    h(
      CompanyProvider,
      null,
      h(
        OrgContext.Provider,
        { value: { projectId: PROJECT_ID, orgId: "acme", org: null } },
        h(AgentsPage),
        h(OrgChartPage),
      ),
    ),
  );
}

/** The Agents page with the create dialog open beside it. */
function CreateBeside({ onCreated }: { onCreated: () => void }) {
  return h(
    ThemeProvider,
    null,
    h(
      CompanyProvider,
      null,
      h(AgentsPage),
      h(CreateOrganizationDialog, { open: true, onClose: () => {}, onCreated }),
    ),
  );
}

describe("hiring, leaving and creating beside the Agents page", () => {
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

  it("turns a former employee's delete button on at once after it leaves", async () => {
    agentServer(undefined, { organizations: [ACME] });
    await mountAgentApp(h(ChartBeside), { route: "/list", at: "/list" });
    await waitFor(() => cardOf("acme_dev") !== undefined);
    expect(deleteButtonOf("acme_dev").disabled).toBe(true);
    await waitFor(() => hasMenuOf("acme_dev"));
    await click(button(`acme_dev · ${en.company.chart.nodeMenu}`));
    await click(button(en.company.chart.leave));
    await click(buttonIn(topDialog(), en.company.chart.leave));

    await waitFor(() => !deleteButtonOf("acme_dev").disabled);
    expect(deleteButtonOf("shared_writer").disabled).toBe(true);
  });

  it("lists the new CEO's Agent at once after a creation, as an employee", async () => {
    agentServer();
    const onCreated = vi.fn();
    await mountAgentApp(h(CreateBeside, { onCreated }), { route: "/list", at: "/list" });
    await waitFor(() => cardOf("Helper") !== undefined);
    await type(field(en.company.orgId), "zeta");
    await type(field(en.company.mission), "Ship the site");
    await click(buttonIn(topDialog(), en.common.create));

    await waitFor(() => onCreated.mock.calls.length === 1);
    await waitFor(() => cardOf("zeta_ceo") !== undefined);
    expect(deleteButtonOf("zeta_ceo").disabled).toBe(true);
  });
});
