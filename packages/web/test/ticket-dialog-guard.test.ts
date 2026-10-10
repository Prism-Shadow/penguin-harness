// @vitest-environment jsdom
/**
 * A ticket's detail dialog (features/company/ticket-dialog.tsx): its sections edit in place,
 * under the settings commit model, against a fake of the ticket routes.
 *
 * - A section's Save waits for an edit and writes it at once, with no second question.
 * - An emptied title holds the summary's Save.
 * - Leaving a section with unsaved edits asks first — its Cancel, and the dialog's close —
 *   "keep editing" keeps the text; an untouched section closes without a question.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h, useEffect } from "react";
import { MemoryRouter } from "react-router";
import type { OrgTicketDetail } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { TicketDialogHost } from "../src/features/company/ticket-dialog";
import { AuthProvider } from "../src/state/auth";
import { CompanyProvider, useCompany } from "../src/state/company";
import { ProjectProvider } from "../src/state/project";
import { ThemeProvider } from "../src/state/theme";
import { ADMIN_ME } from "./helpers/admin-settings";
import { PROJECT } from "./helpers/project-settings";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch } from "./helpers/fetch";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  mount,
  pressEscape,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const TICKET: OrgTicketDetail = {
  ticketId: "T-1",
  title: "Write the install guide",
  status: "in_progress",
  owner: "agent:writer",
  notify: [],
  priority: "P1",
  sessions: [],
  running: false,
  cost: 0,
  goal: "Ship the guide",
  acceptanceCriteria: "",
  progress: [],
  result: "",
  history: [],
  body: "",
  children: [],
  rolledUpCost: 0,
  sessionItems: [],
};

const ORG = "/api/projects/p1/organizations/acme";

/** The ticket's routes: GET reads it, PUT merges the update into it and answers it. */
function ticketServer(): FakeFetch {
  let ticket = { ...TICKET };
  return stubFetch((req) => {
    if (req.path === "/api/me") return json(ADMIN_ME);
    if (req.path === "/api/projects") return json({ projects: [PROJECT] });
    if (req.path === "/api/projects/p1/agents") return json({ agents: [] });
    if (req.path === `${ORG}/tickets/T-1` && req.method === "PUT") {
      ticket = { ...ticket, ...(req.body as Partial<OrgTicketDetail>) };
      return json(ticket);
    }
    if (req.path === `${ORG}/tickets/T-1`) return json(ticket);
    if (req.path === `${ORG}/tickets`) {
      return json({
        columns: { proposed: [], in_progress: [ticket], review: [], done: [], rejected: [] },
        invalidFiles: [],
      });
    }
    if (req.path === `${ORG}/chart`) {
      return json({
        ceoAgentId: "writer",
        employees: [
          {
            agentId: "writer",
            name: "Writer",
            title: "Docs engineer",
            reportsTo: null,
            workspace: ".",
            state: "idle",
            spend: { own: 0, cumulative: 0 },
          },
        ],
      });
    }
    return apiError(404, "not_found");
  });
}

/** Opens the ticket the way every company surface does: by naming it in the shell state. */
function OpenTicket() {
  const company = useCompany();
  useEffect(() => {
    company.openTicket("p1", "acme", "T-1");
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

async function openTicket() {
  const network = ticketServer();
  await mount(
    h(
      MemoryRouter,
      null,
      h(
        ThemeProvider,
        null,
        h(
          AuthProvider,
          null,
          h(
            ProjectProvider,
            null,
            h(CompanyProvider, null, h(OpenTicket), h(TicketDialogHost), h(UnsavedPrompt)),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => document.body.textContent?.includes("Ship the guide") === true);
  return network;
}

/** The section's own Edit button: the summary's comes first, then the goal's. */
const editGoal = () =>
  click(
    [...document.querySelectorAll("button")].filter((b) => b.textContent === en.common.edit)[1]!,
  );
const promptOpen = () => hasButton(en.common.discard);

describe("a ticket's sections", () => {
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

  it("writes an edited section at once on Save, and only once it changed", async () => {
    const network = await openTicket();
    await editGoal();
    expect(button(en.common.save).disabled).toBe(true);
    await type(field(en.company.tickets.goal), "Ship the guide and the FAQ");
    await click(button(en.common.save));
    await waitFor(() => network.requests.some((r) => r.method === "PUT"));
    expect(dialogs()).toHaveLength(1);
    expect(network.requests.find((r) => r.method === "PUT")!.body).toEqual({
      goal: "Ship the guide and the FAQ",
    });
  });

  it("holds the summary's Save while the title is empty", async () => {
    await openTicket();
    await click(button(en.common.edit));
    await type(field(en.company.tickets.ticketTitle), " ");
    expect(button(en.common.save).disabled).toBe(true);
  });

  it("asks before Cancel or the dialog's close drop an edited section", async () => {
    await openTicket();
    await editGoal();
    await type(field(en.company.tickets.goal), "Ship the guide and the FAQ");
    await click(button(en.common.cancel));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(field(en.company.tickets.goal).value).toBe("Ship the guide and the FAQ");

    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.discard));
    expect(dialogs()).toEqual([]);
  });

  it("closes an untouched section without a question", async () => {
    await openTicket();
    await editGoal();
    await click(button(en.common.cancel));
    expect(promptOpen()).toBe(false);
    expect(hasButton(en.common.save)).toBe(false);
  });
});
