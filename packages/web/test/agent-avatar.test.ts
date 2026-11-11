// @vitest-environment jsdom
/**
 * An Agent's own avatar in the Web App: changed in the Overview tab of its settings page, in a
 * field above the name, with the profile row's controls (features/agents/agent-avatar-field.tsx
 * over the shared components/ui/avatar-picker.tsx), and drawn wherever the Agent is, looked up
 * once (lib/agent-avatar.ts) — with an organization's own picture of its employee first on
 * company surfaces (features/company/employee-avatar.tsx).
 *
 * - The page's header and the Overview's avatar field draw the Agent's default until it has a
 *   picture. Change avatar decodes the picked file and opens the crop dialog; nothing is written
 *   until the crop is confirmed, and then the encoded picture is written once and the header and
 *   the field both show what was stored.
 * - The header only shows the avatar: on another tab it is still drawn, and nothing changes it.
 * - The picture saves outside the Overview's draft: a typed name stays typed and unsaved, Save and
 *   Reset answer for the name alone, and a clean form stays clean.
 * - A machine's Agent is written through that machine, and its header shows the picture the
 *   machine serves.
 * - Cancelling the crop writes nothing.
 * - Restore default is held while there is no picture; with one, it asks first: cancelled,
 *   nothing is written; confirmed, the picture is removed and the default is back.
 * - A write the server refuses says why, and the header keeps what is stored.
 * - A file that cannot be decoded says so and opens no crop dialog.
 * - Outside an organization an Agent is drawn with its own picture, else its default; in an
 *   organization, the employee's picture beats the Agent's own, which beats the default.
 */
import { createElement as h, type ReactElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSummary,
  OrgChartResponse,
  OrgEmployeeItem,
  OrganizationSummary,
} from "@prismshadow/penguin-server/api";
import { hasUnsaved, toastStore } from "@prismshadow/penguin-ui";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { AgentSelect } from "../src/features/agents/agent-select";
import { EmployeeAvatar } from "../src/features/company/employee-avatar";
import { CompanyContext, type CompanyContextValue } from "../src/lib/company-context";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AuthProvider } from "../src/state/auth";
import { ProjectProvider } from "../src/state/project";
import { ADMIN_ME } from "./helpers/admin-settings";
import { AGENT_ID, PROJECT_ID, agentConfig, agentServer, mountAgentApp } from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  mount,
  pickFile,
  settle,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";
import { fakeBrowserImage } from "./helpers/browser-image";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { PROJECT } from "./helpers/project-settings";

/** What the browser's canvas encodes the cropped square as, through the image-boundary fake. */
const ENCODED = "data:image/png;base64,iVBORw0KGgo=";

const toasts = () => toastStore.getState().items.map((t) => t.text);

/** What an avatar element draws: its picture's path and query, or "default". */
const drawnBy = (el: Element | null): string => {
  if (el === null) return "none";
  if (el.tagName !== "IMG") return "default";
  const url = new URL((el as HTMLImageElement).src);
  return url.pathname + url.search;
};

/** The Overview's avatar field: the group its legend names "Avatar". */
const avatarField = (): HTMLFieldSetElement | null =>
  [...document.querySelectorAll("fieldset")].find(
    (set) => set.querySelector("legend")?.textContent === en.profile.avatar,
  ) ?? null;

/** What the field's preview draws. */
const fieldAvatar = () => drawnBy(avatarField()?.querySelector(".ui-avatar") ?? null);

/** What the page's header draws: the one avatar outside the field, at the head of the page. */
const headerAvatar = () =>
  drawnBy(
    [...document.querySelectorAll(".ui-avatar")].find((el) => !el.closest("fieldset")) ?? null,
  );

const fileInput = () => avatarField()!.querySelector<HTMLInputElement>('input[type="file"]')!;
const restoreButton = () => button(en.profile.restoreDefaultOf(en.profile.avatar));
const nameField = () => field(en.common.name);

/** A button of the topmost dialog. */
function inDialog(name: string): HTMLButtonElement {
  const dialog = dialogs().at(-1);
  const found = [...(dialog?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === name,
  );
  if (found === undefined) throw new Error(`no dialog button named ${JSON.stringify(name)}`);
  return found;
}

const AGENT_PICTURE = (rev: string, machine = "") =>
  `${machine}/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/avatar?rev=${rev}`;

beforeAll(() => setActiveStrings(en));
afterAll(() => setActiveStrings(zh));

describe("the Agent settings page's avatar", () => {
  beforeEach(() => {
    fakeBrowserImage({ encoded: ENCODED });
    toastStore.setState({ items: [] });
  });
  afterEach(async () => {
    await unmountAll();
    vi.restoreAllMocks();
  });

  async function openPage(machineId: string | null = null, tab = "overview") {
    const server = agentServer(
      agentConfig(),
      machineId === null ? {} : { machines: [{ machineId, alias: "lab", agents: [AGENT_ID] }] },
    );
    const query = new URLSearchParams({ tab });
    if (machineId !== null) query.set("machine", machineId);
    await mountAgentApp(h(AgentSettingsPage), { at: `/agents/${AGENT_ID}?${query}` });
    await waitFor(() => document.querySelector("h1") !== null && headerAvatar() !== "none");
    return server;
  }

  /** Picks a file and confirms the crop dialog it opens. */
  async function changeAvatar() {
    await pickFile(fileInput(), new File(["x"], "me.jpg", { type: "image/jpeg" }));
    await waitFor(() => dialogs().length === 1);
    expect(dialogs()[0]!.textContent).toContain(en.profile.cropAvatar);
    await click(inDialog(en.profile.useAvatar));
  }

  it("writes the cropped picture once, on confirm, and then shows the stored one", async () => {
    const server = await openPage();
    expect(headerAvatar()).toBe("default");
    expect(fieldAvatar()).toBe("default");
    await pickFile(fileInput(), new File(["x"], "me.jpg", { type: "image/jpeg" }));
    await waitFor(() => dialogs().length === 1);
    expect(server.writes("/avatar")).toEqual([]);

    await click(inDialog(en.profile.useAvatar));
    await waitFor(() => fieldAvatar() === AGENT_PICTURE("rev1"));
    expect(headerAvatar()).toBe(AGENT_PICTURE("rev1"));
    expect(server.writes("/avatar").map((w) => w.body)).toEqual([{ avatar: ENCODED }]);
    expect(dialogs()).toEqual([]);
    expect(toasts()).toContain(en.common.saved);
  });

  it("shows the avatar in the header on every tab, and changes it only in the Overview", async () => {
    await openPage(null, "prompt");
    expect(headerAvatar()).toBe("default");
    expect(avatarField()).toBeNull();
    expect(document.body.textContent).not.toContain(en.profile.changeAvatar);
    expect(hasButton(en.profile.restoreDefaultOf(en.profile.avatar))).toBe(false);

    await click(button(en.agent.tabOverview));
    await waitFor(() => avatarField() !== null);
    expect(avatarField()!.textContent).toContain(en.profile.changeAvatar);
    expect(avatarField()!.contains(restoreButton())).toBe(true);
  });

  it("saves outside the Overview's draft: a typed name stays typed, a clean form stays clean", async () => {
    const server = await openPage();
    await changeAvatar();
    await waitFor(() => fieldAvatar() === AGENT_PICTURE("rev1"));
    expect(button(en.common.save).disabled).toBe(true);
    expect(button(en.common.reset).disabled).toBe(true);
    expect(hasUnsaved()).toBe(false);

    await type(nameField(), "Archivist");
    await changeAvatar();
    await waitFor(() => fieldAvatar() === AGENT_PICTURE("rev2"));
    expect(nameField().value).toBe("Archivist");
    expect(button(en.common.save).disabled).toBe(false);
    expect(hasUnsaved()).toBe(true);
    expect(server.writes("/config")).toEqual([]);

    await click(button(en.common.reset));
    expect(nameField().value).toBe("Helper");
    expect(fieldAvatar()).toBe(AGENT_PICTURE("rev2"));
    expect(server.writes("/avatar")).toHaveLength(2);
  });

  it("writes a machine's Agent through that machine, and shows the picture it serves", async () => {
    const server = await openPage("m-lab");
    await changeAvatar();
    await waitFor(() => headerAvatar() === AGENT_PICTURE("rev1", "/server/m-lab"));
    expect(server.writes("/avatar").map((w) => w.machine)).toEqual(["m-lab"]);
    expect(server.avatarOf("m-lab", AGENT_ID)).toBe(ENCODED);
    expect(server.avatarOf(null, AGENT_ID)).toBeNull();
  });

  it("writes nothing when the crop is cancelled", async () => {
    const server = await openPage();
    await pickFile(fileInput(), new File(["x"], "me.jpg", { type: "image/jpeg" }));
    await waitFor(() => dialogs().length === 1);
    await click(inDialog(en.common.cancel));
    await settle();
    expect(dialogs()).toEqual([]);
    expect(server.writes("/avatar")).toEqual([]);
    expect(headerAvatar()).toBe("default");
  });

  it("asks before Restore default removes the picture, and holds it while there is none", async () => {
    const server = await openPage();
    expect(restoreButton().disabled).toBe(true);
    await changeAvatar();
    await waitFor(() => !restoreButton().disabled);

    await click(restoreButton());
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0]!.textContent).toContain(en.profile.avatarResetConfirm);
    await click(inDialog(en.common.cancel));
    expect(server.writes("/avatar")).toHaveLength(1);
    expect(headerAvatar()).toBe(AGENT_PICTURE("rev1"));

    await click(restoreButton());
    await click(inDialog(en.profile.restoreDefault));
    await waitFor(() => headerAvatar() === "default");
    expect(server.writes("/avatar").map((w) => w.body)).toEqual([
      { avatar: ENCODED },
      { avatar: null },
    ]);
    expect(server.avatarOf(null, AGENT_ID)).toBeNull();
  });

  it("says why a refused write failed, and keeps what is stored", async () => {
    const server = await openPage();
    server.refuseNext(400, "bad_request", "avatar is not a png image");
    await changeAvatar();
    await waitFor(() => toasts().includes("avatar is not a png image"));
    await settle();
    expect(headerAvatar()).toBe("default");
    expect(server.avatarOf(null, AGENT_ID)).toBeNull();
  });

  it("says a file is unreadable and opens no crop dialog", async () => {
    fakeBrowserImage({ decodes: false });
    const server = await openPage();
    await pickFile(fileInput(), new File(["x"], "notes.txt", { type: "image/png" }));
    await waitFor(() => toasts().length > 0);
    expect(toasts()).toContain(en.profile.avatarUnreadable);
    expect(dialogs()).toEqual([]);
    expect(server.writes("/avatar")).toEqual([]);
  });
});

describe("which picture an Agent is drawn with", () => {
  const agent = (agentId: string, avatarRev?: string): AgentSummary => ({
    agentId,
    name: agentId,
    activeSessionCount: 0,
    sessionCount: 0,
    sessionActivity: [],
    toolCount: 0,
    version: 1,
    kernelOutdated: false,
    vaultKeyCount: 0,
    scheduleCount: 0,
    workbenchCount: 0,
    skillCount: 0,
    hookCount: 0,
    pluginUpdates: [],
    memoryCount: 0,
    apiEnabled: false,
    ...(avatarRev !== undefined ? { avatarRev } : {}),
  });
  /** `writer` and `reviewer` have pictures of their own; `editor` has none. */
  const AGENTS = [agent("writer", "w1"), agent("reviewer", "r1"), agent("editor")];

  const employee = (agentId: string, avatarRev?: string) =>
    ({
      agentId,
      name: agentId,
      ...(avatarRev !== undefined ? { avatarRev } : {}),
    }) as OrgEmployeeItem;
  /** The organization pictures `writer` its own way, and nobody else. */
  const CHART: OrgChartResponse = {
    ceoAgentId: "writer",
    employees: [employee("writer", "e1"), employee("reviewer"), employee("editor")],
  };
  const ORG = { projectId: "p1", orgId: "acme" } as OrganizationSummary;
  /** The open organization, as the company store hands it to its surfaces. */
  const company = { currentOrg: ORG, orgChart: CHART } as unknown as CompanyContextValue;

  beforeEach(() => {
    stubFetch((req) => {
      if (req.path === "/api/me") return json(ADMIN_ME);
      if (req.path === "/api/projects") return json({ projects: [PROJECT] });
      if (req.path === "/api/projects/p1/agents") return json({ agents: AGENTS });
      return apiError(404, "not_found");
    });
  });
  afterEach(unmountAll);

  async function inProject(...children: ReactElement[]) {
    await mount(h(AuthProvider, null, h(ProjectProvider, null, ...children)));
  }

  /** What each avatar in `root` draws, in order. */
  const drawn = (root: Element) => [...root.querySelectorAll(".ui-avatar")].map(drawnBy);

  it("is the Agent's own picture outside an organization, else its default", async () => {
    await inProject(
      h(AgentSelect, {
        agents: AGENTS,
        selected: AGENTS[0]!,
        onSelect: () => {},
        empty: "",
      }),
    );
    const pill = () => button(en.chat.chooseAgent);
    await waitFor(() => pill().querySelector("img.ui-avatar") !== null);
    expect(drawn(pill())).toEqual(["/api/projects/p1/agents/writer/avatar?rev=w1"]);
    await click(pill());
    const rows = dialogs()[0]!;
    expect(drawn(rows)).toEqual([
      "/api/projects/p1/agents/writer/avatar?rev=w1",
      "/api/projects/p1/agents/reviewer/avatar?rev=r1",
      "default",
    ]);
  });

  it("in an organization, is the employee's picture first, then the Agent's own, then the default", async () => {
    await inProject(
      h(
        CompanyContext.Provider,
        { value: company },
        h(
          "div",
          { "data-faces": "" },
          ...["writer", "reviewer", "editor"].map((id) =>
            h(EmployeeAvatar, { key: id, id, size: 22 }),
          ),
        ),
      ),
    );
    const root = () => document.querySelector("[data-faces]")!;
    await waitFor(() => root().querySelectorAll("img.ui-avatar").length === 2);
    expect(drawn(root())).toEqual([
      "/api/projects/p1/organizations/acme/employees/writer/avatar?rev=e1",
      "/api/projects/p1/agents/reviewer/avatar?rev=r1",
      "default",
    ]);
  });
});
