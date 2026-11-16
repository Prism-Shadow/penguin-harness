/** @vitest-environment jsdom */
/**
 * A workbench's zip import and per-row export on the Agent settings page's Plugins tab
 * (features/agents/agent-workbenches.tsx), the import reached through the tab's Import menu.
 *
 * - Picking a zip in the import dialog posts it as it was read, to the server the Agent lives on,
 *   closes the dialog, says it was imported and lists the workbench it installed.
 * - An import whose load failed says so, with the load's error, and never that it succeeded.
 * - A zip whose id is taken asks before overwriting, naming the id the answer names: cancelling
 *   sends nothing more, confirming resends the same zip with `overwrite`.
 * - A refused zip leaves the dialog open with the reason in it.
 * - Export downloads the workbench's archive from the machine the Agent lives on, under the name
 *   the server gives it; one the server refuses says why.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  AGENT_ID,
  PROJECT_ID,
  agentServer,
  buttonIn,
  mountAgentApp,
  topDialog,
} from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import { button, click, dialogs, menuItem, pickFile, unmountAll, waitFor } from "./helpers/dom";

const info = (id: string, name: string): WorkbenchInfo => ({
  id,
  name,
  version: "1",
  revision: "current",
  uiRev: null,
  loadedAt: "2026-11-03T00:00:00Z",
  error: null,
  hints: [],
  tabs: [],
});

const ZIP = "PK zip bytes";
const ZIP_BASE64 = Buffer.from(ZIP).toString("base64");
const ARCHIVE = `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/workbenches/archive`;

const GPU: FakeMachine = { machineId: "gpu1", alias: "gpu-box", agents: [AGENT_ID] };

/** The toasts on screen, by kind. */
const toasts = (kind: "success" | "error") =>
  toastStore
    .getState()
    .items.filter((item) => item.kind === kind)
    .map((item) => item.text);

/**
 * The tab with Support listed; `imported` is what an upload installs, `machine` where the Agent
 * lives, `archiveRefusal` what a download answers instead of the zip.
 */
async function openTab({
  imported,
  machine,
  archiveRefusal,
}: {
  imported?: WorkbenchInfo;
  machine?: FakeMachine;
  archiveRefusal?: { status: number; code: string };
} = {}) {
  const server = agentServer(undefined, {
    workbenches: [info("support", "Support")],
    ...(imported !== undefined ? { importedWorkbench: imported } : {}),
    ...(machine !== undefined ? { machines: [machine] } : {}),
    ...(archiveRefusal !== undefined ? { archiveRefusal } : {}),
  });
  const query = machine !== undefined ? `&machine=${machine.machineId}` : "";
  await mountAgentApp(h(AgentSettingsPage), { at: `/agents/${AGENT_ID}?tab=plugins${query}` });
  await waitFor(() => document.body.textContent?.includes("Support") === true);
  return server;
}

/** Opens the import dialog and picks the zip in it. */
async function importZip(): Promise<void> {
  if (dialogs().length === 0) {
    await click(button(en.agentPlugins.importAction));
    await click(menuItem(en.agentPlugins.importWorkbench));
    await waitFor(() => dialogs().length === 1);
  }
  await pickFile(
    topDialog().querySelector<HTMLInputElement>('input[type="file"]')!,
    new File([ZIP], "todo.zip"),
  );
}

describe("a workbench's archives on the Plugins tab", () => {
  beforeEach(() => {
    setActiveStrings(en);
    toastStore.setState({ items: [] });
  });
  afterEach(async () => {
    await unmountAll();
    vi.restoreAllMocks();
    setActiveStrings(zh);
  });

  it("posts a picked zip as it was read to the Agent's machine, closes the dialog, says so and lists what it installed", async () => {
    const server = await openTab({ imported: info("todo", "Todo"), machine: GPU });
    await importZip();
    await waitFor(() => server.writes(ARCHIVE).length === 1);
    expect(server.writes(ARCHIVE)[0]).toMatchObject({
      machine: "gpu1",
      body: { dataBase64: ZIP_BASE64 },
    });
    await waitFor(() => dialogs().length === 0);
    await waitFor(() => document.body.textContent?.includes("Todo") === true);
    expect(toasts("success")).toHaveLength(1);
    expect(toasts("error")).toEqual([]);
  });

  it("says an import whose load failed did not load, with the load's error, and never that it succeeded", async () => {
    const broken = { ...info("todo", "Todo"), error: 'package.json must set "type": "module"' };
    await openTab({ imported: broken });
    await importZip();
    await waitFor(() => dialogs().length === 0);
    expect(toasts("success")).toEqual([]);
    expect(toasts("error")).toHaveLength(1);
    expect(toasts("error")[0]).toContain('package.json must set "type": "module"');
  });

  it("asks before overwriting a taken id: cancelling sends nothing more, confirming resends the zip with overwrite", async () => {
    const server = await openTab({ imported: info("support", "Support") });
    await importZip();
    await waitFor(() => dialogs().length === 2);
    expect(topDialog().textContent).toContain(en.workbenches.importOverwriteBody("support"));
    await click(buttonIn(topDialog(), en.common.cancel));
    await waitFor(() => dialogs().length === 1);
    expect(server.writes(ARCHIVE)).toHaveLength(1);

    await importZip();
    await waitFor(() => dialogs().length === 2);
    await click(buttonIn(topDialog(), en.workbenches.importOverwriteAction));
    await waitFor(() => server.writes(ARCHIVE).length === 3);
    expect(server.writes(ARCHIVE).map((write) => write.body)).toEqual([
      { dataBase64: ZIP_BASE64 },
      { dataBase64: ZIP_BASE64 },
      { dataBase64: ZIP_BASE64, overwrite: true },
    ]);
    await waitFor(() => dialogs().length === 0);
  });

  it("keeps the dialog open with the reason when the zip is refused", async () => {
    const server = await openTab({ imported: info("todo", "Todo") });
    server.refuseNext(400, "bad_request", "The zip must contain package.json at its root");
    await importZip();
    await waitFor(
      () => topDialog().textContent?.includes("The zip must contain package.json") === true,
    );
    expect(dialogs()).toHaveLength(1);
  });

  it("downloads a workbench's archive from the machine its Agent lives on, under the server's name", async () => {
    const server = await openTab({ machine: GPU });
    // jsdom has no object URLs and navigates nowhere: the anchor's click is where the file is saved.
    const NodeUrl = globalThis.URL;
    vi.stubGlobal(
      "URL",
      class extends NodeUrl {
        static createObjectURL = () => "blob:workbench";
        static revokeObjectURL = () => {};
      },
    );
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    await click(button(`${en.workbenches.more} Support`));
    await click(menuItem(en.workbenches.exportWorkbench));
    await waitFor(() => saved.length === 1);
    expect(saved).toEqual(["support-v1.zip"]);
    const download = server
      .requests()
      .find((request) => request.path.endsWith("/workbenches/support/archive"));
    expect(download).toMatchObject({ method: "GET", machine: "gpu1" });
  });

  it("says why the server refused an export, and saves nothing", async () => {
    await openTab({ archiveRefusal: { status: 413, code: "workbench_too_large" } });
    const click_ = vi.spyOn(HTMLAnchorElement.prototype, "click");
    await click(button(`${en.workbenches.more} Support`));
    await click(menuItem(en.workbenches.exportWorkbench));
    await waitFor(() => toasts("error").length === 1);
    expect(toasts("error")).toEqual([en.errors.byCode.workbench_too_large]);
    expect(click_).not.toHaveBeenCalled();
  });
});
