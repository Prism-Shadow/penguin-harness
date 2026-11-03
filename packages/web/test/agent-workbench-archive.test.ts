/** @vitest-environment jsdom */
/**
 * The Workbenches tab's zip import and per-row export (features/agents/workbenches-tab.tsx).
 *
 * - Picking a zip in the import dialog posts it as it was read, closes the dialog and lists the
 *   workbench it installed.
 * - A zip whose id is taken asks before overwriting, naming the id the answer names: cancelling
 *   sends nothing more, confirming resends the same zip with `overwrite`.
 * - A refused zip leaves the dialog open with the reason in it.
 * - Export downloads the workbench's archive from the machine the Agent lives on, under the name
 *   the server gives it.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
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
import { button, click, dialogs, pickFile, unmountAll, waitFor } from "./helpers/dom";

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

/** The tab with Support listed; `imported` is what an upload installs. */
async function openTab(imported?: WorkbenchInfo, machine?: FakeMachine) {
  const server = agentServer(undefined, {
    workbenches: [info("support", "Support")],
    ...(imported !== undefined ? { importedWorkbench: imported } : {}),
    ...(machine !== undefined ? { machines: [machine] } : {}),
  });
  const query = machine !== undefined ? `&machine=${machine.machineId}` : "";
  await mountAgentApp(h(AgentSettingsPage), { at: `/agents/${AGENT_ID}?tab=workbenches${query}` });
  await waitFor(() => document.body.textContent?.includes("Support") === true);
  return server;
}

/** Opens the import dialog and picks the zip in it. */
async function importZip(): Promise<void> {
  if (dialogs().length === 0) {
    await click(button(en.workbenches.importAction));
    await waitFor(() => dialogs().length === 1);
  }
  await pickFile(
    topDialog().querySelector<HTMLInputElement>('input[type="file"]')!,
    new File([ZIP], "todo.zip"),
  );
}

describe("the Workbenches tab's archives", () => {
  beforeEach(() => setActiveStrings(en));
  afterEach(async () => {
    await unmountAll();
    vi.restoreAllMocks();
    setActiveStrings(zh);
  });

  it("posts a picked zip as it was read, closes the dialog and lists what it installed", async () => {
    const server = await openTab(info("todo", "Todo"));
    await importZip();
    await waitFor(() => server.writes(ARCHIVE).length === 1);
    expect(server.writes(ARCHIVE)[0]!.body).toEqual({ dataBase64: ZIP_BASE64 });
    await waitFor(() => dialogs().length === 0);
    await waitFor(() => document.body.textContent?.includes("Todo") === true);
  });

  it("asks before overwriting a taken id: cancelling sends nothing more, confirming resends the zip with overwrite", async () => {
    const server = await openTab(info("support", "Support"));
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
    const server = await openTab(info("todo", "Todo"));
    server.refuseNext(400, "bad_request", "The zip must contain package.json at its root");
    await importZip();
    await waitFor(
      () => topDialog().textContent?.includes("The zip must contain package.json") === true,
    );
    expect(dialogs()).toHaveLength(1);
  });

  it("downloads a workbench's archive from the machine its Agent lives on, under the server's name", async () => {
    const machine: FakeMachine = { machineId: "gpu1", alias: "gpu-box", agents: [AGENT_ID] };
    const server = await openTab(undefined, machine);
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
    await click(button(`${en.workbenches.exportWorkbench} Support`));
    await waitFor(() => saved.length === 1);
    expect(saved).toEqual(["support-v1.zip"]);
    const download = server
      .requests()
      .find((request) => request.path.endsWith("/workbenches/support/archive"));
    expect(download).toMatchObject({ method: "GET", machine: "gpu1" });
  });
});
