/**
 * The system apps as their readers see them (lib/system-apps.ts), over the features' own pages:
 * which apps a viewer has, and where the App Center's nav row stays lit besides its own page.
 *
 * System apps come from released page declarations accessible to the viewer. The Evaluation
 * Center's old addresses (`/benchmark…`) are no system app's: they lead into a workbench's window.
 */
import { describe, expect, it } from "vitest";
import { onSystemApp, systemAppsOf } from "../src/lib/system-apps";
import { SYSTEM_APP_PAGES } from "./helpers/system-app-pages";

describe("systemAppsOf", () => {
  it("gives an administrator the system apps in their order", () => {
    expect(systemAppsOf(SYSTEM_APP_PAGES, true).map((app) => [app.key, app.path])).toEqual([
      ["models", "/models"],
      ["plugins", "/plugins"],
      ["machines", "/machines"],
      ["usage", "/usage"],
    ]);
  });

  it("gives a member the system apps without Machines", () => {
    expect(systemAppsOf(SYSTEM_APP_PAGES, false).map((app) => app.key)).toEqual([
      "models",
      "plugins",
      "usage",
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
  it("is true on each system app's page", () => {
    for (const path of ["/models", "/plugins", "/machines", "/usage"])
      expect(onSystemApp(path, SYSTEM_APP_PAGES, true)).toBe(true);
  });

  it("recognizes a registered child route under a system app", () => {
    const detail = SYSTEM_APP_PAGES.find((page) => page.key === "system-app")!;
    const pages = [...SYSTEM_APP_PAGES, { ...detail, key: "model-detail", path: "/models/:id" }];
    expect(onSystemApp("/models/sample", pages, true)).toBe(true);
  });

  it("is false on the other pages", () => {
    for (const path of [
      "/agents",
      "/agents/helper",
      "/apps",
      "/chat/s1",
      "/models/elsewhere",
      "/benchmark",
      "/benchmark/b1",
    ])
      expect(onSystemApp(path, SYSTEM_APP_PAGES, true)).toBe(false);
  });

  it("is false on Machines for a member", () => {
    expect(onSystemApp("/machines", SYSTEM_APP_PAGES, false)).toBe(false);
  });
});
