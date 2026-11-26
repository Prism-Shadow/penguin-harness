/** @vitest-environment jsdom */
/**
 * The Evaluation Center's old addresses (features/app-center/legacy-benchmark-redirect.tsx),
 * against the package's fake server: `/benchmark` and every address under it lead into the
 * Self-Evolution Workbench's App Center window, in place of the history entry they arrived in.
 *
 * - The window is the default Agent's workbench when the App Center lists it as the
 *   `rsi-workbench` plugin's, else another Agent's; a `benchmark` workbench the plugin did not
 *   install is neither. One taken out of the App Center opens all the same, in its window, with
 *   no offer to install it again.
 * - The rest of the path and the query are the window's `at`, which reads back as that place
 *   inside the app; the bare address opens the window at its start, with no `at`.
 * - A list that cannot be read leads to the default Agent's window.
 * - With no Agent's, the App Center opens with an offer: installing puts the plugin on the
 *   default Agent and opens its window at the place the address named; a refused install says
 *   why and leaves the offer; the offer's cross takes it away.
 */
import { createElement as h } from "react";
import { afterEach, beforeAll, expect, it } from "vitest";
import type { AppCenterShortcut, PluginItem } from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { AppCenterPage } from "../src/features/app-center/app-center-page";
import { LegacyBenchmarkRedirect } from "../src/features/app-center/legacy-benchmark-redirect";
import { windowAt } from "../src/lib/app-window-address";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ThemeProvider } from "../src/state/theme";
import { PROJECT_ID, agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import { button, click, run, unmountAll, waitFor } from "./helpers/dom";

beforeAll(() => setActiveStrings(en));

afterEach(async () => {
  await unmountAll();
  toastStore.setState({ items: [] });
});

/** A `benchmark` workbench's tile on an Agent, with the plugin that installed it, if any. */
const benchmarkApp = (agentId: string, plugin?: string): AppCenterShortcut => ({
  agentId,
  agentName: agentId,
  workbenchId: "benchmark",
  title: "Self-Evolution Workbench",
  ...(plugin !== undefined ? { plugin } : {}),
  path: `/app/${PROJECT_ID}/${agentId}/benchmark`,
  build: "ready",
});

/** The library's entry of the plugin that ships the workbench. */
const RSI_WORKBENCH = {
  name: "rsi-workbench",
  title: "Self-Evolution Workbench",
  description: "",
  version: "0.2.0",
  package: "@penguinharness/rsi-workbench",
  source: "builtin",
  skills: [
    { name: "benchmark-design", description: "", version: "1" },
    { name: "agent-evaluation", description: "", version: "1" },
  ],
  hooks: [],
  mcpServers: [],
  workbenches: [{ name: "benchmark", version: "2026.11.26.1" }],
} as PluginItem;

const AGENTS = [{ agentId: "default_agent", name: "General Agent" }, { agentId: "analyst" }];

/** Arrives at the old address `at` from the conversations, with the real App Center at /apps. */
async function arrive(
  at: string,
  options: {
    apps?: AppCenterShortcut[];
    hiddenApps?: AppCenterShortcut[];
    library?: PluginItem[];
    listFails?: boolean;
  } = {},
) {
  const server = agentServer(undefined, {
    moreAgents: AGENTS,
    apps: options.apps ?? [],
    hiddenApps: options.hiddenApps ?? [],
    library: options.library ?? [],
  });
  if (options.listFails === true) server.failNext(null, /\/app-center$/);
  const router = await mountAgentApp(h(ThemeProvider, null, h(AppCenterPage)), {
    route: "/apps",
    at,
    extra: [{ path: "/benchmark/*", element: h(LegacyBenchmarkRedirect) }],
  });
  await waitFor(() => router.state.location.pathname === "/apps");
  return { server, router };
}

type Router = Awaited<ReturnType<typeof arrive>>["router"];

/** The app whose window the address puts in front, and the place it asks of that app. */
const windowOf = (router: Router) => ({
  app: new URLSearchParams(router.state.location.search).get("app"),
  at: windowAt(router.state.location),
});

const tile = (key: string) => document.querySelector(`li[data-app="${key}"]`);
const offer = () => document.body.textContent?.includes(en.appCenter.legacyBenchmark.notice);

it("opens the default Agent's workbench at the place the address names, in place of the entry it arrived in", async () => {
  const { router } = await arrive("/benchmark/report-writing?agentId=analyst", {
    apps: [
      benchmarkApp("analyst", "rsi-workbench"),
      benchmarkApp("default_agent", "rsi-workbench"),
    ],
  });
  expect(windowOf(router)).toEqual({
    app: "default_agent/benchmark",
    at: "/report-writing?agentId=analyst",
  });
  await run(() => router.navigate(-1));
  expect(whereIs(router)).toBe("/chat");
});

it("opens another Agent's when the default Agent has none, and passes over one the plugin did not install", async () => {
  const { router } = await arrive("/benchmark/b1", {
    apps: [benchmarkApp("default_agent"), benchmarkApp("analyst", "rsi-workbench")],
  });
  expect(windowOf(router)).toEqual({ app: "analyst/benchmark", at: "/b1" });
});

it("opens the plugin's workbench taken out of the App Center in its window, offering no install", async () => {
  const { router } = await arrive("/benchmark/b1?agentId=analyst", {
    apps: [benchmarkApp("analyst")],
    hiddenApps: [benchmarkApp("default_agent", "rsi-workbench")],
    library: [RSI_WORKBENCH],
  });
  expect(windowOf(router)).toEqual({ app: "default_agent/benchmark", at: "/b1?agentId=analyst" });
  expect(tile("default_agent/benchmark")).toBeNull();
  await waitFor(() => document.body.textContent?.includes("Self-Evolution Workbench") === true);
  expect(offer()).toBe(false);
});

it("opens the bare address at the workbench's start, with no place in the address", async () => {
  const { router } = await arrive("/benchmark", {
    apps: [benchmarkApp("default_agent", "rsi-workbench")],
  });
  expect(whereIs(router)).toBe("/apps?app=default_agent%2Fbenchmark");
  expect(windowOf(router).at).toBeNull();
});

it("leads to the default Agent's window when the App Center's list cannot be read", async () => {
  const { router } = await arrive("/benchmark/b1?agentId=analyst", { listFails: true });
  expect(windowOf(router)).toEqual({ app: "default_agent/benchmark", at: "/b1?agentId=analyst" });
});

it("offers to install the workbench on the default Agent when no Agent has it, then opens it there", async () => {
  const { server, router } = await arrive("/benchmark/b1?agentId=analyst", {
    apps: [benchmarkApp("analyst")],
    library: [RSI_WORKBENCH],
  });
  expect(whereIs(router)).toBe("/apps");
  await waitFor(() => offer() === true);
  expect(tile("default_agent/benchmark")).toBeNull();

  await click(button(en.appCenter.legacyBenchmark.install));
  await waitFor(() => tile("default_agent/benchmark") !== null);
  expect(
    server.writes(`/api/projects/${PROJECT_ID}/agents/default_agent/plugins`).map((w) => w.body),
  ).toEqual([{ names: ["rsi-workbench"] }]);
  expect(windowOf(router)).toEqual({ app: "default_agent/benchmark", at: "/b1?agentId=analyst" });
  expect(offer()).toBe(false);
  await run(() => router.navigate(-1));
  expect(whereIs(router)).toBe("/chat");
});

it("says why a refused install failed and keeps the offer, whose cross then takes it away", async () => {
  const { router } = await arrive("/benchmark");
  await waitFor(() => offer() === true);

  await click(button(en.appCenter.legacyBenchmark.install));
  await waitFor(() => toastStore.getState().items.length === 1);
  expect(offer()).toBe(true);
  expect(whereIs(router)).toBe("/apps");

  // The notice's other button is its close cross, named in the interface's own words.
  const install = button(en.appCenter.legacyBenchmark.install);
  const notice = install.closest(".ui-notice")!;
  await click([...notice.querySelectorAll("button")].find((b) => b !== install)!);
  await waitFor(() => offer() === false);
  expect(whereIs(router)).toBe("/apps");
});
