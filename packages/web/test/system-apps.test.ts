/**
 * The system apps as their readers see them (lib/system-apps.ts), over the features' own pages:
 * which apps a viewer has, and where the App Center's nav row stays lit besides its own page.
 *
 * - The apps are the pages contributed with `app`, in their order: Models, Plugins, Machines, the
 *   Cost Center and the Evaluation Center for an administrator; a member has no Machines.
 * - A page not offered yet (`released: false`) is no app, even with `app`.
 * - The App Center's row is lit on each app's page and on a page under one by its route (a
 *   Benchmark's detail page under the Evaluation Center), whatever the query; not on other pages,
 *   and not on Machines for a member, who has no such app.
 */
import { describe, expect, it } from "vitest";
import { onSystemApp, systemAppsOf } from "../src/lib/system-apps";
import { SYSTEM_APP_PAGES } from "./helpers/system-app-pages";

describe("systemAppsOf", () => {
  it("gives an administrator the five system apps in their order", () => {
    expect(systemAppsOf(SYSTEM_APP_PAGES, true).map((app) => [app.key, app.path])).toEqual([
      ["models", "/models"],
      ["plugins", "/plugins"],
      ["machines", "/machines"],
      ["usage", "/usage"],
      ["benchmark", "/benchmark"],
    ]);
  });

  it("gives a member the system apps without Machines", () => {
    expect(systemAppsOf(SYSTEM_APP_PAGES, false).map((app) => app.key)).toEqual([
      "models",
      "plugins",
      "usage",
      "benchmark",
    ]);
  });

  it("leaves out a page not offered yet", () => {
    const pages = SYSTEM_APP_PAGES.map((page) =>
      page.key === "usage" ? { ...page, released: false } : page,
    );
    expect(systemAppsOf(pages, true).map((app) => app.key)).not.toContain("usage");
  });
});

describe("onSystemApp", () => {
  it("is true on each system app's page and on a page under one", () => {
    for (const path of [
      "/models",
      "/plugins",
      "/machines",
      "/usage",
      "/benchmark",
      "/benchmark/b1",
    ])
      expect(onSystemApp(path, SYSTEM_APP_PAGES, true)).toBe(true);
  });

  it("is false on the other pages", () => {
    for (const path of ["/agents", "/agents/helper", "/apps", "/chat/s1", "/models/elsewhere"])
      expect(onSystemApp(path, SYSTEM_APP_PAGES, true)).toBe(false);
  });

  it("is false on Machines for a member", () => {
    expect(onSystemApp("/machines", SYSTEM_APP_PAGES, false)).toBe(false);
  });
});
