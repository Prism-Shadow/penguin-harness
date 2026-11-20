// @vitest-environment jsdom
/**
 * One read per machine (lib/machine-catalogs.ts), as the App Center reads each machine's apps.
 *
 * - Given a connected machine, it is asked once and its answer shows, live.
 * - Given a machine that goes out of reach, its last answer stands, not live; when it connects
 *   again it is asked again at once, though it answered moments ago.
 * - Given a machine that refuses the read (403), what it answered before is forgotten, in the page
 *   and in the tab's storage.
 * - Given a machine that leaves the Project's list, its answer goes with it: coming back, it
 *   starts from nothing rather than from what it showed before.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { ApiError } from "../src/api/client";
import { createCatalogStore } from "../src/lib/catalog-storage";
import { useMachineCatalogs } from "../src/lib/machine-catalogs";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { publishMachinesChanged } from "../src/state/machines";
import { useProject } from "../src/state/project";
import { agentServer, mountAgentApp } from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import { click, run, unmountAll, waitFor } from "./helpers/dom";

const store = createCatalogStore<string[]>("test-apps.v1", (apps) => apps, Array.isArray);

/** What each machine answers next, by machine id: a list of apps, or a refusal. */
const answers = new Map<string, () => Promise<string[]>>();
const asked: string[] = [];
const load = (_projectId: string, machineId: string) => {
  asked.push(machineId);
  return answers.get(machineId)?.() ?? Promise.resolve([]);
};
const askedOf = (machineId: string) => asked.filter((id) => id === machineId).length;

/** A page's reading of every machine: one line per machine, its state and its apps. */
function CatalogsProbe() {
  const projectId = useProject().currentProject?.projectId ?? null;
  const catalogs = useMachineCatalogs(store, projectId, load);
  return h(
    "ul",
    null,
    catalogs.map((c) =>
      h(
        "li",
        { key: c.machine.machineId, "data-machine": c.machine.label },
        `${c.live ? "live" : "not live"}: ${c.value === null ? "nothing" : c.value.join(",")}`,
        h("button", { type: "button", onClick: c.refresh }, `Refresh ${c.machine.label}`),
      ),
    ),
  );
}

/** What the probe shows for one machine, without its button; null while it lists none. */
const shown = (alias: string) => {
  const row = document.querySelector(`[data-machine="${alias}"]`);
  return row === null ? null : (row.firstChild?.textContent ?? "");
};
const refreshButton = (alias: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === `Refresh ${alias}`)!;
/** The tab's kept copies of one machine's answers. */
const kept = (machineId: string) =>
  Object.keys(sessionStorage).filter(
    (key) => key.startsWith("penguin.catalog.test-apps.v1") && key.endsWith(`\u0000${machineId}`),
  ).length;

const GPU: FakeMachine = { machineId: "gpu1", alias: "gpu-box", agents: ["default_agent"] };

async function openProbe(machines: FakeMachine[]) {
  const server = agentServer(undefined, { machines });
  await mountAgentApp(h(CatalogsProbe), { route: "/probe", at: "/probe" });
  return server;
}

describe("each machine's catalog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    answers.clear();
    asked.length = 0;
    sessionStorage.clear();
    localStorage.clear();
  });

  it("asks a connected machine once and shows its answer, live", async () => {
    answers.set("gpu1", async () => ["desk"]);
    await openProbe([GPU]);
    await waitFor(() => shown("gpu-box") === "live: desk");
    expect(askedOf("gpu1")).toBe(1);
    expect(kept("gpu1")).toBe(1);
  });

  it("keeps the last answer while the machine is out of reach, and asks again when it connects", async () => {
    answers.set("gpu1", async () => ["desk"]);
    const server = await openProbe([GPU]);
    await waitFor(() => shown("gpu-box") === "live: desk");

    server.setReconnecting("gpu1", true);
    await run(() => publishMachinesChanged());
    await waitFor(() => shown("gpu-box") === "not live: desk");

    answers.set("gpu1", async () => ["desk", "notes"]);
    server.setReconnecting("gpu1", false);
    await run(() => publishMachinesChanged());
    // Moments after its first answer: only the reconnect makes it worth asking again.
    await waitFor(() => shown("gpu-box") === "live: desk,notes");
    expect(askedOf("gpu1")).toBe(2);
  });

  it("forgets what a machine answered once it refuses the read", async () => {
    answers.set("gpu1", async () => ["desk"]);
    await openProbe([GPU]);
    await waitFor(() => shown("gpu-box") === "live: desk");

    answers.set("gpu1", () =>
      Promise.reject(new ApiError(403, "project_forbidden", "Access revoked.")),
    );
    await click(refreshButton("gpu-box"));
    await waitFor(() => shown("gpu-box") === "not live: nothing");
    expect(kept("gpu1")).toBe(0);
  });

  it("forgets a machine that leaves the Project's list, so it comes back with nothing", async () => {
    answers.set("gpu1", async () => ["desk"]);
    const server = await openProbe([GPU]);
    await waitFor(() => shown("gpu-box") === "live: desk");

    server.setListed("gpu1", false);
    await run(() => publishMachinesChanged());
    await waitFor(() => shown("gpu-box") === null);
    expect(kept("gpu1")).toBe(0);

    // Back on the list, its read held: what it showed before does not reappear meanwhile.
    let answer: (apps: string[]) => void = () => {};
    answers.set("gpu1", () => new Promise((resolve) => (answer = resolve)));
    server.setListed("gpu1", true);
    await run(() => publishMachinesChanged());
    await waitFor(() => shown("gpu-box") === "not live: nothing");
    await run(() => answer(["notes"]));
    await waitFor(() => shown("gpu-box") === "live: notes");
  });
});
