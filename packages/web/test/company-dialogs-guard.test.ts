// @vitest-environment jsdom
/**
 * The company mode's form dialogs under the settings commit model: the organization's settings
 * (features/company/org-dialogs.tsx), an employee's budget (features/company/employee-dialogs.tsx)
 * and a channel's rename (features/company/channel-dialogs.tsx).
 *
 * - Save waits until a field differs from what is stored, and while a required field is empty
 *   or a value is malformed (said under the field as it is typed).
 * - Closing with edits asks first: "keep editing" keeps the dialog and the typing, "discard"
 *   closes it; an untouched dialog closes at once.
 * - Pausing the organization writes at once, alone, and the typed fields beside it keep their
 *   edits.
 * - An employee's budget is written by its Save, with no second question; so is a calendar
 *   event (features/company/calendar-page.tsx).
 * - A desk renewal is valid untouched — a plain renewal, writing no workspace — and asks before
 *   Esc drops a changed workspace. Once it has renewed, nothing is left unsaved by the time the
 *   page is told, so the page's move to the new desk session is not held by the leave guard.
 * - A new ticket (features/company/tickets-page.tsx) waits for a title and a slug that keeps
 *   its rule, said under the field as it is typed.
 * - A hire writes at once, the employee's name with it; a new Agent whose picked plugin runs a
 *   stdio MCP server asks first, showing the command it runs on this server, and the question's
 *   own Hire hires.
 * - An employee's name is written by its Save alone, once it differs from the stored one, and
 *   Esc asks before a typed name is dropped.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h, Fragment } from "react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import type { OrgEmployeeItem, OrganizationSettings } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { OrganizationSettingsDialog } from "../src/features/company/org-dialogs";
import {
  DeskRenewDialog,
  EmployeeEditDialog,
  EmployeeProfileDialog,
  HireDialog,
} from "../src/features/company/employee-dialogs";
import { ChannelTextDialog } from "../src/features/company/channel-dialogs";
import { CalendarEventDialog } from "../src/features/company/calendar-page";
import { CreateTicketDialog } from "../src/features/company/tickets-page";
import { ThemeProvider } from "../src/state/theme";
import { AuthProvider } from "../src/state/auth";
import { CompanyProvider } from "../src/features/company/company-state";
import { LocaleProvider } from "../src/state/locale";
import { ProjectProvider } from "../src/state/project";
import { SessionsProvider } from "../src/state/sessions";
import { ADMIN_ME } from "./helpers/admin-settings";
import { buttonIn, topDialog } from "./helpers/agent-app";
import { PROJECT } from "./helpers/project-settings";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch } from "./helpers/fetch";
import {
  button,
  click,
  field,
  hasButton,
  mount,
  pressEscape,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const promptOpen = () => hasButton(en.common.discard);

const SETTINGS: OrganizationSettings = {
  name: "Acme",
  mission: "Ship the docs",
  status: "active",
  timezone: "Asia/Shanghai",
  approvalMode: "allow-all",
  mentionChainLimit: 3,
  budgetWarnRatio: 0.8,
  budgetPauseRatio: 1,
  createdBy: "admin",
};

/** The organization's routes: GET reads the settings, PATCH merges into them and answers them. */
function organizationServer(): FakeFetch {
  let settings = { ...SETTINGS };
  return stubFetch((req) => {
    if (req.path === "/api/projects/p1/organizations/acme" && req.method === "GET") {
      return json({ settings });
    }
    if (req.path === "/api/projects/p1/organizations/acme" && req.method === "PATCH") {
      settings = { ...settings, ...(req.body as Partial<OrganizationSettings>) };
      return json(settings);
    }
    if (req.path === "/api/projects/p1/models") return json({ providers: {}, models: [] });
    // The shell around the dialog: the workspace picker reads the conversations' recent folders.
    if (req.path === "/api/me") return json(ADMIN_ME);
    if (req.path === "/api/projects") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    return apiError(404, "not_found");
  });
}

describe("the organization settings dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    // The conversations' live stream, which jsdom does not have; nothing here listens to it.
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    );
  });
  afterEach(async () => {
    await unmountAll();
  });

  async function openSettings() {
    const network = organizationServer();
    const onClose = vi.fn();
    await mount(
      h(
        AuthProvider,
        null,
        h(
          ProjectProvider,
          null,
          h(
            SessionsProvider,
            null,
            h(OrganizationSettingsDialog, {
              open: true,
              projectId: "p1",
              orgId: "acme",
              onClose,
              onChanged: () => {},
            }),
            h(UnsavedPrompt),
          ),
        ),
      ),
    );
    await waitFor(() => field(en.company.displayName).value === "Acme");
    return { network, onClose };
  }

  it("waits for a change before Save goes live, and holds it while the name is empty", async () => {
    await openSettings();
    expect(button(en.common.save).disabled).toBe(true);
    await type(field(en.company.mission), "Ship the docs and the site");
    expect(button(en.common.save).disabled).toBe(false);
    await type(field(en.company.displayName), "  ");
    expect(button(en.common.save).disabled).toBe(true);
  });

  it("asks before Esc drops the typing, and closes an untouched dialog at once", async () => {
    const { onClose } = await openSettings();
    await type(field(en.company.mission), "Ship the docs and the site");
    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(field(en.company.mission).value).toBe("Ship the docs and the site");

    await type(field(en.company.mission), "Ship the docs");
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pauses at once, alone, and keeps the mission being typed", async () => {
    const { network } = await openSettings();
    await type(field(en.company.mission), "Ship the docs and the site");
    await click(button(en.company.pause));
    await waitFor(() => hasButton(en.company.resume));
    expect(network.requests.find((r) => r.method === "PATCH")!.body).toEqual({ status: "paused" });
    expect(field(en.company.mission).value).toBe("Ship the docs and the site");
    expect(button(en.common.save).disabled).toBe(false);
  });
});

const EMPLOYEE: OrgEmployeeItem = {
  agentId: "writer",
  name: "Writer",
  title: "Docs engineer",
  reportsTo: "ceo",
  workspace: "docs",
  budget: 50,
  state: "idle",
  spend: { own: 0, cumulative: 0 },
};

describe("an employee's budget", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });
  afterEach(async () => {
    await unmountAll();
  });

  async function openBudget() {
    const network = stubFetch((req) =>
      json({ ...EMPLOYEE, budget: (req.body as { budget: number }).budget }),
    );
    const onClose = vi.fn();
    const onSaved = vi.fn();
    await mount(
      h(
        ThemeProvider,
        null,
        h(EmployeeEditDialog, {
          edit: "budget",
          projectId: "p1",
          orgId: "acme",
          employee: EMPLOYEE,
          employees: [EMPLOYEE],
          onClose,
          onSaved,
        }),
        h(UnsavedPrompt),
      ),
    );
    return { network, onClose, onSaved };
  }

  it("is written by Save alone, once it differs from the stored budget and is a budget", async () => {
    const { network, onSaved } = await openBudget();
    expect(button(en.common.save).disabled).toBe(true);
    await type(field(en.company.chart.budget), "-5");
    expect(button(en.common.save).disabled).toBe(true);
    expect(field(en.company.chart.budget).getAttribute("aria-invalid")).toBe("true");
    await type(field(en.company.chart.budget), "80");
    await click(button(en.common.save));
    await waitFor(() => onSaved.mock.calls.length === 1);
    expect(network.requests.map((r) => [r.method, r.body])).toEqual([["PATCH", { budget: 80 }]]);
  });

  it("asks before Cancel drops an edited budget", async () => {
    const { onClose } = await openBudget();
    await type(field(en.company.chart.budget), "80");
    await click(button(en.common.cancel));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.discard));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("a channel's rename", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for a new name, holds an empty one, and asks before Esc drops it", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn(async () => {});
    await mount(
      h(
        Fragment,
        null,
        h(ChannelTextDialog, {
          open: true,
          title: en.company.channels.rename,
          label: en.company.channels.nameField,
          initial: "general",
          required: true,
          onClose,
          onSubmit,
        }),
        h(UnsavedPrompt),
      ),
    );
    expect(button(en.common.save).disabled).toBe(true);
    await type(field(en.company.channels.nameField), "");
    expect(button(en.common.save).disabled).toBe(true);
    await type(field(en.company.channels.nameField), "announcements");
    expect(button(en.common.save).disabled).toBe(false);
    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    await click(button(en.common.save));
    await waitFor(() => onSubmit.mock.calls.length === 1);
    expect(onSubmit).toHaveBeenCalledWith("announcements");
  });
});

describe("the calendar event dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for a name and a prompt, writes the event on Create, and asks before Esc drops it", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn(async () => true);
    await mount(
      h(
        Fragment,
        null,
        h(CalendarEventDialog, {
          opening: {
            editing: null,
            agentId: "writer",
            name: "",
            title: "",
            prompt: "",
            enabled: true,
            startAt: "2026-10-12T09:00",
            endAt: "",
            period: "",
          },
          event: undefined,
          employees: [EMPLOYEE],
          busy: false,
          onClose,
          onSave,
          onDelete: () => {},
          onOpenDesk: () => {},
        }),
        h(UnsavedPrompt),
      ),
    );
    expect(button(en.common.create).disabled).toBe(true);
    await type(field(en.company.calendar.name), "daily_sweep");
    expect(button(en.common.create).disabled).toBe(true);
    await type(field(en.company.calendar.prompt), "Sweep the inbox.");
    expect(button(en.common.create).disabled).toBe(false);

    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    await click(button(en.common.create));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "daily_sweep", prompt: "Sweep the inbox." }),
    );
  });
});

describe("the new ticket dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for a title and a slug that keeps its rule, and asks before Cancel drops the typing", async () => {
    stubFetch(() => apiError(404, "not_found"));
    const onClose = vi.fn();
    await mount(
      h(
        Fragment,
        null,
        h(CreateTicketDialog, {
          open: true,
          projectId: "p1",
          orgId: "acme",
          employees: [],
          tickets: [],
          onClose,
          onCreated: () => {},
        }),
        h(UnsavedPrompt),
      ),
    );
    expect(button(en.common.create).disabled).toBe(true);
    await type(field(en.company.tickets.ticketTitle), "Write the FAQ");
    expect(button(en.common.create).disabled).toBe(false);
    await type(field(en.company.tickets.slug), "Bad Slug");
    expect(document.body.textContent).toContain(en.company.tickets.slugInvalid);
    expect(button(en.common.create).disabled).toBe(true);

    await click(button(en.common.cancel));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.discard));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("a desk renewal", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  async function openRenewal() {
    const network = stubFetch((req) =>
      req.path.endsWith("/desk") ? json({ sessionId: "desk-2" }) : json(EMPLOYEE),
    );
    const onClose = vi.fn();
    const onRenewed = vi.fn();
    await mount(
      h(
        Fragment,
        null,
        h(DeskRenewDialog, {
          open: true,
          projectId: "p1",
          orgId: "acme",
          employee: EMPLOYEE,
          onClose,
          onChartChanged: () => {},
          onRenewed,
        }),
        h(UnsavedPrompt),
      ),
    );
    return { network, onClose, onRenewed };
  }

  it("renews untouched without rewriting the workspace", async () => {
    const { network, onRenewed } = await openRenewal();
    await click(button(en.company.chart.renewDesk));
    await waitFor(() => onRenewed.mock.calls.length === 1);
    expect(network.requests.map((r) => r.method)).toEqual(["POST"]);
  });

  it("leaves nothing unsaved by the time it hands a renewed desk on", async () => {
    const { onRenewed } = await openRenewal();
    let unsavedAtHandOff: boolean | null = null;
    onRenewed.mockImplementation(() => {
      unsavedAtHandOff = hasUnsaved();
    });
    await type(field(en.company.chart.workspace), "docs-v2");
    await click(button(en.company.chart.renewDesk));
    await waitFor(() => onRenewed.mock.calls.length === 1);
    expect(unsavedAtHandOff).toBe(false);
  });

  it("asks before Esc drops a changed workspace", async () => {
    const { onClose } = await openRenewal();
    await type(field(en.company.chart.workspace), "docs-v2");
    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.discard));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const ORG = "/api/projects/p1/organizations/acme";

const CEO: OrgEmployeeItem = {
  agentId: "ceo",
  name: "Chief",
  title: "CEO",
  reportsTo: null,
  workspace: ".",
  state: "idle",
  spend: { own: 0, cumulative: 0 },
};

/** The plugin library: one plugin whose MCP server is a command this server runs. */
const LIBRARY = {
  groups: [
    {
      id: "tools",
      title: "Tools",
      plugins: [
        {
          name: "mail",
          description: "Mail tools",
          version: "1.0.0",
          title: "Mail tools",
          skills: [],
          mcpServers: [
            {
              name: "mail",
              transport: "stdio",
              target: "node mail-server.js",
              setup: [],
              oauth: false,
              signIn: false,
            },
          ],
        },
      ],
    },
  ],
};

/** The org routes a personnel dialog writes, inside the shell the company surfaces sit in. */
function companyServer(): FakeFetch {
  return stubFetch((req) => {
    if (req.path === "/api/me") return json(ADMIN_ME);
    if (req.path === "/api/projects") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    if (req.path === "/api/plugins") return json(LIBRARY);
    if (req.path === `${ORG}/employees` && req.method === "POST") {
      return json({ ...EMPLOYEE, ...(req.body as { title: string }) });
    }
    if (req.path === `${ORG}/employees/writer` && req.method === "PATCH") {
      return json({ ...EMPLOYEE, ...(req.body as object) });
    }
    return apiError(404, "not_found");
  });
}

/** Mounts a personnel dialog the way the org chart does: inside the company shell. */
async function mountInCompany(dialog: ReactElement) {
  await mount(
    h(
      MemoryRouter,
      null,
      h(
        LocaleProvider,
        null,
        h(
          ThemeProvider,
          null,
          h(
            AuthProvider,
            null,
            h(ProjectProvider, null, h(CompanyProvider, null, dialog, h(UnsavedPrompt))),
          ),
        ),
      ),
    ),
  );
}

/** The posts a hire made, by their bodies. */
const hires = (network: FakeFetch) =>
  network.requests.filter((r) => r.method === "POST" && r.path === `${ORG}/employees`);

describe("hiring", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    );
  });
  afterEach(async () => {
    await unmountAll();
  });

  async function openHire() {
    const network = companyServer();
    const onHired = vi.fn();
    await mountInCompany(
      h(HireDialog, {
        open: true,
        projectId: "p1",
        orgId: "acme",
        manager: CEO,
        employees: [CEO],
        onClose: () => {},
        onHired,
      }),
    );
    // The new-Agent half opens: the Project has no Agent left to hire.
    await waitFor(() => document.body.textContent?.includes(en.company.chart.agentIdHint) === true);
    await waitFor(() => network.requests.some((r) => r.path === "/api/plugins"));
    return { network, onHired };
  }

  /** The employee's name box: the second "Name", after the new Agent's own. */
  const employeeName = () =>
    [...document.querySelectorAll<HTMLInputElement>("input")].filter((f) =>
      [...(f.labels ?? [])].some((l) => l.textContent?.startsWith(en.company.chart.employeeName)),
    )[1]!;

  it("hires at once, the employee's name with it, when nothing picked runs a command here", async () => {
    const { network, onHired } = await openHire();
    await type(field(en.company.chart.agentId), "writer");
    await type(employeeName(), "Wren");
    await type(field(en.company.chart.employeeTitle), "Docs engineer");
    await click(button(en.company.chart.hire));
    await waitFor(() => onHired.mock.calls.length === 1);
    expect(hires(network).map((r) => r.body)).toEqual([
      {
        name: "Wren",
        title: "Docs engineer",
        reportsTo: "ceo",
        newAgent: { agentId: "writer", plugins: ["agent-company", "agent-development"] },
      },
    ]);
  });

  it("asks before a new Agent whose picked plugin runs a stdio server is hired, and the question's Hire hires", async () => {
    const { network, onHired } = await openHire();
    await type(field(en.company.chart.agentId), "writer");
    await type(field(en.company.chart.employeeTitle), "Docs engineer");
    await click(button(en.company.chart.plugins));
    const row = [...document.querySelectorAll("[aria-pressed]")].find((b) =>
      b.textContent?.includes("mail"),
    );
    await click(row!);
    await click(button(en.company.chart.hire));
    expect(topDialog().textContent).toContain("node mail-server.js");
    expect(hires(network)).toEqual([]);

    await click(buttonIn(topDialog(), en.company.chart.hire));
    await waitFor(() => onHired.mock.calls.length === 1);
    expect(
      hires(network).map((r) => (r.body as { newAgent: { plugins: string[] } }).newAgent.plugins),
    ).toEqual([["agent-company", "agent-development", "mail"]]);
  });
});

describe("an employee's name and picture", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    );
  });
  afterEach(async () => {
    await unmountAll();
  });

  it("writes a changed name with Save alone, and asks before Esc drops a typed one", async () => {
    const network = companyServer();
    const onClose = vi.fn();
    const onChanged = vi.fn();
    await mountInCompany(
      h(EmployeeProfileDialog, {
        open: true,
        projectId: "p1",
        orgId: "acme",
        employee: EMPLOYEE,
        onClose,
        onChanged,
      }),
    );
    expect(button(en.common.save).disabled).toBe(true);
    await type(field(en.company.chart.employeeName), "Wren");
    expect(button(en.common.save).disabled).toBe(false);
    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(field(en.company.chart.employeeName).value).toBe("Wren");

    await click(button(en.common.save));
    await waitFor(() => onClose.mock.calls.length === 1);
    expect(network.requests.filter((r) => r.method === "PATCH").map((r) => r.body)).toEqual([
      { name: "Wren" },
    ]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(promptOpen()).toBe(false);
  });
});
