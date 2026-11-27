// @vitest-environment jsdom
/**
 * A server install runs on across the market's pages (features/plugins/server-installs.ts): it is
 * kept by the page load, not by the page that started it.
 *
 * - Given an install started from one page, when that page goes away (the person opens the
 *   plugin's page, or leaves the market), the install keeps running, and a page mounted later
 *   shows the step it is at; once the server answers, the install leaves and its answer is the
 *   list this server holds for the Project.
 * - Given an install running in a Project, a second change there starts nothing.
 * - Given an install that fails, it stays, with why and the step it stopped at, until dismissed.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledPluginsResponse } from "@prismshadow/penguin-server/api";
import { mount, run, unmountAll } from "./helpers/dom";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

vi.mock("../src/api/endpoints", () => ({
  installPluginStream: vi.fn(),
  uninstallPlugin: vi.fn(),
}));
import * as api from "../src/api/endpoints";
import { ApiError } from "../src/api/client";
import {
  dismissServerFailure,
  runServerChange,
  serverRun,
  useServerRun,
} from "../src/features/plugins/server-installs";
import { installedPlugins, installedPluginsKey } from "../src/features/plugins/plugin-reads";

const CHANGE = {
  projectId: "A",
  machineId: "self",
  specifier: "@acme/notes",
  install: true,
  title: "Notes",
};
const LIST: InstalledPluginsResponse = {
  machineId: "self",
  file: "project.toml",
  restartPending: false,
  shipped: [],
  plugins: [
    {
      specifier: "@acme/notes",
      active: true,
      builtin: false,
      modules: [],
      replaces: [],
      everywhere: true,
      machines: [],
      here: true,
    },
  ],
};

/** A page that shows where the install of `@acme/notes` stands. */
function Watcher() {
  const run = useServerRun("A", "self", "@acme/notes");
  return h("p", { "data-run": run?.phase ?? "none" }, run?.stage?.stage ?? "");
}
const shown = () => document.querySelector("[data-run]");

beforeEach(() => setActiveStrings(en));
afterEach(async () => {
  await unmountAll();
  vi.resetAllMocks();
});

describe("a server install across the market's pages", () => {
  it("runs on after the page that started it goes, and a page mounted later shows its step", async () => {
    let report: (stage: api.InstallStage) => void = () => undefined;
    let finish: (list: InstalledPluginsResponse) => void = () => undefined;
    vi.mocked(api.installPluginStream).mockImplementationOnce(
      (_p, _s, _m, _progress, onStage) =>
        new Promise((resolve) => {
          report = onStage!;
          finish = resolve;
        }),
    );
    const first = await mount(h(Watcher));
    let done!: Promise<boolean>;
    await run(() => {
      done = runServerChange(CHANGE, { selfId: "self" });
    });
    expect(shown()?.getAttribute("data-run")).toBe("running");
    await first.unmount();

    await run(() => report({ stage: "loading" }));
    expect(serverRun("A", "self", "@acme/notes")?.stage).toEqual({ stage: "loading" });
    await mount(h(Watcher));
    expect(shown()?.getAttribute("data-run")).toBe("running");
    expect(shown()?.textContent).toBe("loading");

    await run(async () => {
      finish(LIST);
      await done;
    });
    expect(shown()?.getAttribute("data-run")).toBe("none");
    expect(installedPlugins.get(installedPluginsKey("A", null)).value).toEqual(LIST);
  });

  it("starts no second change in a Project while one runs", async () => {
    vi.mocked(api.installPluginStream).mockImplementation(() => new Promise(() => undefined));
    void runServerChange(CHANGE, { selfId: "self" });
    const second = await runServerChange(
      { ...CHANGE, specifier: "@acme/other", title: "Other" },
      { selfId: "self" },
    );
    expect(second).toBe(false);
    expect(api.installPluginStream).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed install with why and where it stopped, until it is dismissed", async () => {
    vi.mocked(api.installPluginStream).mockImplementationOnce(async (_p, _s, _m, progress) => {
      progress(6, 10);
      throw new ApiError(
        400,
        "plugin_install_failed",
        "the connection closed before the file was complete",
      );
    });
    await run(async () => {
      await runServerChange(CHANGE, { selfId: "self" });
    });
    const failed = serverRun("A", "self", "@acme/notes")!;
    expect(failed.phase).toBe("failed");
    expect(failed.failure?.progress).toEqual({ received: 6, total: 10 });
    expect(failed.failure?.failure.text).toContain("the connection closed");
    dismissServerFailure("A", "self", "@acme/notes");
    expect(serverRun("A", "self", "@acme/notes")).toBeNull();
  });
});
