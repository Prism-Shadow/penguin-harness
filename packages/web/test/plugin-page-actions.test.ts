// @vitest-environment jsdom
/**
 * A plugin's page in Settings, as the settings page drives it (features/settings/
 * plugins-section.tsx in its plugin scope), against the plugin-config route behind the fetch fake.
 *
 * - An action the report places on its version element asks first: clicking Retry opens the
 *   confirmation and sends nothing; confirming sends that one action.
 * - The report's "check again" runs at once, with no confirmation, whether it sits at the checks'
 *   heading or, with no checks, among the primary actions.
 * - While the program is being prepared, the page reads the groups again every few seconds, and
 *   stops once the report says it is installed.
 * - With a connected machine, the page offers the machine picker, and picking the machine shows
 *   that machine's groups for this plugin.
 * - A picked machine that marks no group with its plugin is not said to have no options: the page
 *   points to the plugin sources page, where a machine on an older build lists them.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement as h, type ComponentType } from "react";
import type { PluginConfigEntry } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { PluginsSection } from "../src/features/settings/plugins-section";
import { MACHINE, draftWorld, mountInWorld } from "./helpers/draft-world";
import { button, click, dialogs, hasButton, mount, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch, type FakeFetch, type FetchRequest } from "./helpers/fetch";

// The frame's socket is the test's own, as in the draft suites.
vi.mock("../test/socket-stand-in", async (importActual) => {
  const actual = await importActual<typeof import("../src/api/socket")>();
  const { socketWorld } = await import("./helpers/api-socket-world");
  return { ...actual, apiSocket: socketWorld.apiSocket };
});

const PKG = "@acme/helper";

/** The settings page in this plugin's scope, as its plugin page mounts it. */
const pluginPage = () => h(PluginsSection as ComponentType<{ plugin: string }>, { plugin: PKG });

const entry = (report: PluginConfigEntry["report"]): PluginConfigEntry => ({
  name: "acme-helper",
  plugin: PKG,
  configuration: { title: "Acme Helper", properties: {} },
  values: {},
  ...(report !== undefined ? { report } : {}),
  actions: [
    { id: "install", title: "Retry" },
    { id: "check", title: "Check again" },
  ],
});

const FAILED = entry({
  version: { name: "acme-desktop", state: "failed", action: "install" },
  checks: [{ id: "display", label: "Display", state: "ok" }],
  recheck: "check",
});

const isConfig = (r: FetchRequest) => r.path === "/api/admin/plugin-config";
const isAction = (r: FetchRequest) =>
  r.path === "/api/admin/plugin-config/action" && r.method === "POST";

/** The plugin-config route: reads answer `current()`, an action answers ok with the same. */
function configServer(current: () => PluginConfigEntry[]): FakeFetch {
  return stubFetch((r) => {
    if (isConfig(r)) return json({ plugins: current() });
    if (isAction(r)) return json({ ok: true, message: "Done.", plugins: current() });
    return apiError(404, "not_found");
  });
}

const posts = (fetch: FakeFetch) => fetch.requests.filter(isAction).map((r) => r.body);
const versionState = () =>
  document.querySelector<HTMLElement>("[data-version-state]")?.dataset.versionState;

describe("a plugin's page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    vi.useRealTimers();
    await unmountAll();
  });

  it("asks before running Retry, and sends it only once confirmed", async () => {
    const fetch = configServer(() => [FAILED]);
    await mount(pluginPage());
    await waitFor(() => hasButton("Retry"));
    await click(button("Retry"));
    expect(dialogs()).toHaveLength(1);
    expect(posts(fetch)).toEqual([]);
    await click(button("Run"));
    expect(posts(fetch)).toEqual([{ name: "acme-helper", action: "install" }]);
  });

  it.each([
    ["at the checks' heading", FAILED],
    [
      "among the primary actions when there are no checks",
      entry({ version: { name: "acme-desktop", state: "preparing" }, recheck: "check" }),
    ],
  ])("runs check again at once, %s", async (_, shown) => {
    const fetch = configServer(() => [shown]);
    await mount(pluginPage());
    await waitFor(() => hasButton("Check again"));
    await click(button("Check again"));
    expect(dialogs()).toHaveLength(0);
    expect(posts(fetch)).toEqual([{ name: "acme-helper", action: "check" }]);
  });

  it("reads again while the program is being prepared, and stops once it is installed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: "preparing" | "installed" = "preparing";
    const fetch = configServer(() => [
      entry({ version: { name: "acme-desktop", state }, recheck: "check" }),
    ]);
    const reads = () => fetch.requests.filter(isConfig).length;
    await mount(pluginPage());
    await waitFor(() => versionState() === "preparing");
    expect(reads()).toBe(1);
    state = "installed";
    await act(() => vi.advanceTimersByTimeAsync(2_100));
    await waitFor(() => versionState() === "installed");
    const settled = reads();
    expect(settled).toBe(2);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(reads()).toBe(settled);
  });
});

describe("a plugin's page with a connected machine", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  /** This server declares nothing for the plugin; the machine answers `remote`. */
  const world = (remote: PluginConfigEntry[]) =>
    draftWorld({
      extra: (r) =>
        isConfig(r) ? json({ plugins: r.machine === MACHINE ? remote : [] }) : undefined,
    });

  it("offers the machine picker, and shows the picked machine's groups for the plugin", async () => {
    const { fetch } = world([FAILED]);
    await mountInWorld(pluginPage());
    await waitFor(() => hasButton("Machine"), 40);
    expect(document.querySelector("[data-plugin-config]")).toBeNull();
    await click(button("Machine"));
    await click(button("lab"));
    await waitFor(() => document.querySelector('[data-plugin-config="acme-helper"]') !== null, 40);
    expect(fetch.requests.filter(isConfig).map((r) => r.machine)).toEqual([null, MACHINE]);
  });

  it("points to plugin sources for a machine that marks no group with its plugin", async () => {
    world([{ name: "acme-old", configuration: { properties: {} }, values: {} }]);
    await mountInWorld(pluginPage());
    await waitFor(() => hasButton("Machine"), 40);
    await click(button("Machine"));
    await click(button("lab"));
    await waitFor(() => document.body.textContent?.includes("older build") === true, 40);
    expect(document.body.textContent).toContain("Plugin sources");
    expect(document.body.textContent).not.toContain("has no options for this plugin");
  });
});
