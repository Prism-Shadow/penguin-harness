// @vitest-environment jsdom
/**
 * The server module of a plugin an Agent carries, on the Agent settings Plugins sub-page
 * (features/agents/agent-plugin-row.tsx, agent-plugin-detail.tsx and their writes), against the
 * shared fake server.
 *
 * - Given a member whose request for the module waits, the row says so and offers nothing more.
 * - Given a member on an Agent whose module is off and was never asked for (an Agent from before
 *   server modules came along with installs), the row says the module is off and offers to ask
 *   the administrator; asking posts the plugin, says so, and the row then reads as waiting.
 * - Given the administrator, the same row offers to enable the module, and once enabled the row
 *   carries no module mark while the detail's line reads it as running.
 * - Given a member installs a plugin whose module needs the administrator, the toast says a
 *   request was sent.
 * - Given the server says a module changed, the sub-page reads the Agent again: a request
 *   decided elsewhere shows without a reload.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginItem, PluginModuleStatus } from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { publishUserEvent } from "../src/lib/amsp/user-events";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  CHARTS,
  NOTES_KIT,
  openAgentPlugins,
  pluginRow,
  pluginRowButton,
} from "./helpers/agent-plugins";
import { button, click, dialogs, hasButton, run, unmountAll, waitFor } from "./helpers/dom";

const words = en.agentPlugins.module;
const HYBRID: PluginItem = { ...CHARTS, modules: true };
const NOTES_HYBRID: PluginItem = { ...NOTES_KIT, modules: true };

const status = (over: Partial<PluginModuleStatus> = {}): PluginModuleStatus => ({
  plugin: "charts",
  package: "@acme/charts",
  builtin: false,
  state: "off",
  listed: false,
  ...over,
});
const waiting = { status: "pending", mine: true, requestedAt: "2026-11-19T08:00:00Z" } as const;

const rowText = () => pluginRow("Charts").textContent ?? "";
const toastTexts = () => toastStore.getState().items.map((t) => t.text);

describe("an Agent plugin's server module", () => {
  beforeEach(() => {
    setActiveStrings(en);
    toastStore.setState({ items: [] });
  });
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    setActiveStrings(zh);
  });

  it("tells a member their request waits for the administrator, and offers nothing more", async () => {
    await openAgentPlugins({
      role: "member",
      admin: false,
      library: [HYBRID, NOTES_KIT],
      modules: [status({ request: waiting })],
    });
    await waitFor(() => rowText().includes(words.mark.awaiting));
    expect(hasButton(`${words.request} Charts`)).toBe(false);
    expect(hasButton(`${words.enable} Charts`)).toBe(false);
  });

  it("lets a member ask for an off module, which then reads as waiting", async () => {
    const { server } = await openAgentPlugins({
      role: "member",
      admin: false,
      library: [HYBRID, NOTES_KIT],
      modules: [status()],
    });
    await waitFor(() => rowText().includes(words.mark.off));
    await click(button(`${words.request} Charts`));
    await waitFor(() => rowText().includes(words.mark.awaiting));
    expect(server.writes("/api/projects/proj/plugins/modules").map((r) => r.body)).toEqual([
      { plugin: "charts" },
    ]);
    expect(toastTexts()).toEqual([words.asked.requested("Charts")]);
    expect(hasButton(`${words.request} Charts`)).toBe(false);
  });

  it("lets the administrator enable it, after which the detail reads it as running", async () => {
    await openAgentPlugins({ library: [HYBRID, NOTES_KIT], modules: [status()] });
    await waitFor(() => rowText().includes(words.mark.off));
    await click(button(`${words.enable} Charts`));
    await waitFor(() => !rowText().includes(words.mark.off));
    expect(toastTexts()).toEqual([words.asked.enabled("Charts")]);

    await click(pluginRowButton("Charts"));
    await waitFor(() => dialogs().length === 1);
    const line = [...dialogs()[0]!.querySelectorAll("li")].find((li) =>
      li.textContent?.startsWith(words.title),
    );
    expect(line?.textContent).toContain(words.state.running);
  });

  it("says in the install's toast that the module was asked of the administrator", async () => {
    await openAgentPlugins({
      role: "member",
      admin: false,
      library: [HYBRID, NOTES_HYBRID],
      modules: [status({ state: "running", listed: true }), status({ plugin: "notes-kit" })],
    });
    await click(button(`${en.skills.install} Notes kit`));
    await waitFor(() => toastStore.getState().items.length === 1);
    expect(toastStore.getState().items[0]).toMatchObject({
      kind: "attention",
      text: en.plugins.moduleInstall.requested(
        `${en.plugins.installedToast("Notes kit", "Helper")}${en.agent.takesEffectSuffix}`,
      ),
    });
  });

  it("reads the Agent again when the server says a module changed", async () => {
    const { server } = await openAgentPlugins({
      role: "member",
      admin: false,
      library: [HYBRID, NOTES_KIT],
      modules: [status({ request: waiting })],
    });
    await waitFor(() => rowText().includes(words.mark.awaiting));
    server.setModules([status({ state: "running", listed: true })]);
    await run(() => publishUserEvent({ type: "plugin_modules_changed" }));
    await waitFor(() => !rowText().includes(words.mark.awaiting));
  });
});
