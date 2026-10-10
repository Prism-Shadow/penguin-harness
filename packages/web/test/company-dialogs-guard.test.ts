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
 *   Esc drops a changed workspace.
 * - A new ticket (features/company/tickets-page.tsx) waits for a title and a slug that keeps
 *   its rule, said under the field as it is typed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h, Fragment } from "react";
import type { OrgEmployeeItem, OrganizationSettings } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { OrganizationSettingsDialog } from "../src/features/company/org-dialogs";
import { DeskRenewDialog, EmployeeEditDialog } from "../src/features/company/employee-dialogs";
import { ChannelTextDialog } from "../src/features/company/channel-dialogs";
import { CalendarEventDialog } from "../src/features/company/calendar-page";
import { CreateTicketDialog } from "../src/features/company/tickets-page";
import { ThemeProvider } from "../src/state/theme";
import { AuthProvider } from "../src/state/auth";
import { ProjectProvider } from "../src/state/project";
import { SessionsProvider } from "../src/state/sessions";
import { ADMIN_ME } from "./helpers/admin-settings";
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

  it("asks before Esc drops a changed workspace", async () => {
    const { onClose } = await openRenewal();
    await type(field(en.company.chart.workspace), "docs-v2");
    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.discard));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
