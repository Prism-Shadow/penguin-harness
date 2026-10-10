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
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h, useState } from "react";
import { useNavigate } from "react-router";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { CreateAgentDialog } from "../src/features/agents/create-agent-dialog";
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

/** The page's part: closes the dialog and goes on to the new Agent at once. */
function Harness() {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  return h(CreateAgentDialog, {
    open,
    projectId: PROJECT_ID,
    library: [],
    libraryError: null,
    onClose: () => setOpen(false),
    onCreated: async () => {
      setOpen(false);
      navigate("/agents");
    },
  });
}

async function openCreate() {
  const server = agentServer();
  const router = await mountAgentApp(h(Harness), { route: "/create", at: "/create" });
  await waitFor(() => dialogs().length === 1);
  return { server, router };
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
