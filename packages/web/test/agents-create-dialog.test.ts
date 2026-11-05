// @vitest-environment jsdom
/**
 * The Agents page's Create Agent dialog (features/agents/create-agent-dialog.tsx) as one record
 * form under the settings commit model.
 *
 * - Create waits for something to be filled in and an id that keeps the naming rule; a broken id
 *   is marked as it is typed.
 * - Esc, Cancel, a press outside and the × each ask while anything is filled in; "keep editing"
 *   leaves the dialog and the typing.
 * - An untouched dialog closes at once.
 * - A created Agent closes the dialog and the page goes on to it without asking: the form was
 *   saved, so the navigation that follows finds nothing unsaved.
 * - A refused create keeps the dialog open with the reason under the id, still unsaved.
 * - A picked plugin with a stdio MCP server asks before anything is created, showing the command
 *   it runs on this server; confirming creates the Agent with the plugin.
 * - With no connected machine there is no location to pick: the Agent is created here.
 * - With one, the first field is the location, this server until changed. Picking the machine
 *   offers that machine's library, and Create creates the Agent there — this server is written
 *   nothing — and hands the page the machine, so it goes to that machine's Agent.
 * - A new location drops the plugins picked for the old one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h, useState } from "react";
import { useNavigate } from "react-router";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { CreateAgentDialog } from "../src/features/agents/create-agent-dialog";
import type { LocationChoice, PluginPickItem } from "../src/features/agents/create-agent-dialog";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import {
  PROJECT_ID,
  agentServer,
  buttonIn,
  fieldIn,
  mountAgentApp,
  topDialog,
  whereIs,
} from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  hasButton,
  pressEscape,
  pressScrim,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

/** A library plugin whose MCP server is a command this server runs. */
const MAIL: PluginPickItem = {
  name: "mail",
  description: "Mail tools",
  version: "1.0.0",
  title: "Mail tools",
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
};

/** A plugin of the machine's own library, which this server's does not have. */
const GPU_TOOLS = {
  name: "gpu-tools",
  description: "CUDA helpers",
  version: "1.0.0",
  title: "GPU tools",
  skills: [],
  hooks: [],
  mcpServers: [],
} as unknown as PluginItem;

const GPU_MACHINE = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: ["default_agent"],
  library: [GPU_TOOLS],
};

/** The page's part: closes the dialog and goes on to the new Agent at once, on its machine. */
function Harness({
  library = [],
  machines = [],
}: {
  library?: PluginPickItem[];
  machines?: LocationChoice[];
}) {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  return h(CreateAgentDialog, {
    open,
    projectId: PROJECT_ID,
    library,
    libraryError: null,
    machines,
    onClose: () => setOpen(false),
    onCreated: async (agentId, machineId) => {
      setOpen(false);
      navigate(machineId === null ? "/agents" : `/agents/${agentId}?machine=${machineId}`);
    },
  });
}

async function openCreate(library: PluginPickItem[] = [], machines: LocationChoice[] = []) {
  const server = agentServer(undefined, { machines: [GPU_MACHINE] });
  const router = await mountAgentApp(h(Harness, { library, machines }), {
    route: "/create",
    at: "/create",
  });
  await waitFor(() => dialogs().length === 1);
  return { server, router };
}

const GPU_CHOICE: LocationChoice = { value: "gpu1", label: "gpu-box" };

/** Picks `label` in the dialog's Location dropdown. */
async function pickLocation(label: string) {
  await click(buttonIn(topDialog(), en.agent.createLocation));
  // The menu is portaled out of the dialog; its rows are the dropdown's options.
  const option = [...document.querySelectorAll("button")].find(
    (b) => !topDialog().contains(b) && b.textContent?.trim() === label,
  );
  if (option === undefined) throw new Error(`no location ${label}`);
  await click(option);
}

/** Opens the plugins picker and toggles the row of `plugin`. */
async function pickPlugin(plugin: string) {
  await click(buttonIn(topDialog(), en.agent.createPlugins));
  const row = [...document.querySelectorAll("[aria-pressed]")].find((b) =>
    b.textContent?.includes(plugin),
  );
  if (row === undefined) throw new Error(`no plugin ${plugin} on offer`);
  await click(row);
}

const name = () => fieldIn(topDialog(), en.common.name);
const id = () => fieldIn(topDialog(), en.agent.id);
const create = () => buttonIn(topDialog(), en.common.create);
const promptOpen = () => hasButton(en.common.discard);

describe("creating an Agent", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for an id that keeps the naming rule, marking a broken one", async () => {
    await openCreate();
    expect(create().disabled).toBe(true);
    await type(name(), "Writer");
    expect(create().disabled).toBe(true);
    await type(id(), "Bad Id");
    expect(create().disabled).toBe(true);
    expect(id().getAttribute("aria-invalid")).toBe("true");
    await type(id(), "writer");
    expect(create().disabled).toBe(false);
    expect(id().getAttribute("aria-invalid")).toBeNull();
  });

  it.each([
    ["Escape", pressEscape],
    ["Cancel", () => click(buttonIn(topDialog(), en.common.cancel))],
    ["a press outside", pressScrim],
    ["the ×", () => click(buttonIn(topDialog(), "Close"))],
  ])("asks on %s with anything typed, and keep editing keeps the typing", async (_, leave) => {
    await openCreate();
    await type(name(), "Writer");
    await leave();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(dialogs()).toHaveLength(1);
    expect(name().value).toBe("Writer");
  });

  it("closes an untouched dialog at once", async () => {
    await openCreate();
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toEqual([]);
  });

  it("goes on to the new Agent without asking once created", async () => {
    const { server, router } = await openCreate();
    await type(name(), "Writer");
    await type(id(), "writer");
    await click(create());
    await waitFor(() => whereIs(router) === "/agents");
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toEqual([]);
    expect(hasUnsaved()).toBe(false);
    expect(server.writes(`/api/projects/${PROJECT_ID}/agents`)[0]!.body).toEqual({
      agentId: "writer",
      name: "Writer",
    });
  });

  it("asks before creating an Agent whose picked plugin runs a stdio server, and creates on confirm", async () => {
    const { server, router } = await openCreate([MAIL]);
    await type(id(), "writer");
    await click(buttonIn(topDialog(), en.agent.createPlugins));
    const row = [...document.querySelectorAll("[aria-pressed]")].find((b) =>
      b.textContent?.includes("mail"),
    );
    await click(row!);
    await click(create());
    expect(dialogs()).toHaveLength(2);
    expect(topDialog().textContent).toContain("node mail-server.js");
    expect(server.writes(`/api/projects/${PROJECT_ID}/agents`)).toEqual([]);

    await click(buttonIn(topDialog(), en.common.create));
    await waitFor(() => whereIs(router) === "/agents");
    expect(server.writes(`/api/projects/${PROJECT_ID}/agents`)[0]!.body).toEqual({
      agentId: "writer",
      plugins: ["mail"],
    });
  });

  it("offers no location without a connected machine, and creates the Agent here", async () => {
    const { server } = await openCreate();
    expect(topDialog().textContent).not.toContain(en.agent.createLocation);
    await type(id(), "writer");
    await click(create());
    await waitFor(() => server.writes(`/api/projects/${PROJECT_ID}/agents`).length === 1);
    expect(server.writes(`/api/projects/${PROJECT_ID}/agents`)[0]!.machine).toBeNull();
  });

  it("creates the Agent on a picked machine, from that machine's library, and goes to it there", async () => {
    const { server, router } = await openCreate([MAIL], [GPU_CHOICE]);
    expect(topDialog().textContent).toContain(en.agent.createLocationHere);
    await pickLocation("gpu-box");
    await waitFor(() =>
      server.fetch.requests.some((r) => r.machine === "gpu1" && r.path === "/api/plugins"),
    );
    await type(id(), "trainer");
    await pickPlugin("gpu-tools");
    await click(create());
    await waitFor(() => whereIs(router) === "/agents/trainer?machine=gpu1");
    const writes = server.writes(`/api/projects/${PROJECT_ID}/agents`);
    expect(writes.map((w) => [w.machine, w.body])).toEqual([
      ["gpu1", { agentId: "trainer", plugins: ["gpu-tools"] }],
    ]);
    expect(server.machineAgents("gpu1")).toContain("trainer");
  });

  it("drops the plugins picked for the old location when the location changes", async () => {
    const { server } = await openCreate([MAIL], [GPU_CHOICE]);
    await type(id(), "writer");
    await pickPlugin("mail");
    expect(topDialog().textContent).toContain(en.agent.createPluginsPicked(1));
    await pickLocation("gpu-box");
    expect(topDialog().textContent).toContain(en.agent.createPluginsPlaceholder);
    await waitFor(() =>
      server.fetch.requests.some((r) => r.machine === "gpu1" && r.path === "/api/plugins"),
    );
    await click(create());
    await waitFor(() => server.writes(`/api/projects/${PROJECT_ID}/agents`).length === 1);
    expect(server.writes(`/api/projects/${PROJECT_ID}/agents`)[0]!.body).toEqual({
      agentId: "writer",
    });
  });

  it("keeps a refused create open with the reason under the id, still unsaved", async () => {
    const { server, router } = await openCreate();
    server.refuseNext(409, "agent_exists");
    await type(id(), "writer");
    await click(create());
    await waitFor(() => topDialog().textContent?.includes(en.errors.byCode.agent_exists) === true);
    expect(id().getAttribute("aria-invalid")).toBe("true");
    expect(whereIs(router)).toBe("/create");
    expect(hasUnsaved()).toBe(true);
  });
});
