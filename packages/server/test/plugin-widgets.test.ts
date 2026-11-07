/**
 * Widgets on the server side: a module's `WebModule.widgets` contribution reaches GET
 * /api/contributions as data (id, contributing module, key, titles, size, renderer), beside
 * the pages and the file renderers — the slot the web app reads to dock a plugin's small
 * companion (web: lib/widgets.ts).
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { ContributionsResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import { uiStampOf } from "../src/plugin/package.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A plugin module that only contributes a widget. */
const pet: ModuleDef = {
  manifest: parseManifest({
    name: "AcmePet",
    requires: {},
    provides: {},
    contributes: {
      "WebModule.widgets": [
        {
          id: "acme.widget",
          key: "pet",
          title: "Pet",
          titleZh: "宠物",
          size: "small",
          renderer: {
            iframe: { src: "/api/plugins/@acme/pet/ui/widget.html", namespace: "pet" },
          },
        },
      ],
    },
    children: [],
  }),
  create: () => ({ api: {}, bind: {} }),
};

describe("web widgets slot", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    await t?.cleanup();
    t = undefined;
  });

  it("serves no widgets without a plugin, and the plugin's one with it", async () => {
    t = await createTestApp();
    const bare = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const none = (await (await bare.get("/api/contributions")).json()) as ContributionsResponse;
    expect(none.widgets).toEqual([]);
    await t.cleanup();

    const host = new PluginHost();
    host.use({ specifier: "@acme/pet", modules: [pet], replaces: [] });
    t = await createTestApp({ plugins: host });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const res = await admin.get("/api/contributions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContributionsResponse;
    expect(body.widgets).toEqual([
      {
        id: "acme.widget",
        from: "AcmePet",
        key: "pet",
        title: "Pet",
        titleZh: "宠物",
        size: "small",
        renderer: {
          iframe: { src: "/api/plugins/@acme/pet/ui/widget.html", namespace: "pet" },
        },
      },
    ]);
  });

  /**
   * The dock mounts a widget's frame ahead of the click that opens it, so the document has to
   * be cacheable — and a widget document is only cacheable if its URL says which version of
   * the plugin's files it is (`?v=`, plugin/package.ts). A contribution the server cannot
   * locate as a package is left exactly as it was written.
   */
  it("puts the version of the plugin's own ui/ files on the widget's document URL", async () => {
    const dir = await makeTempRoot();
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/pet" }));
    await fs.mkdir(path.join(dir, "ui"), { recursive: true });
    await fs.writeFile(path.join(dir, "ui", "widget.html"), "<p>hi</p>");
    const entry = path.join(dir, "index.js");
    await fs.writeFile(entry, "export {};\n");

    const host = new PluginHost();
    host.use({ specifier: "@acme/pet", file: entry, modules: [pet], replaces: [] });
    t = await createTestApp({ plugins: host });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const body = (await (await admin.get("/api/contributions")).json()) as ContributionsResponse;

    const src = (body.widgets[0]?.renderer as { iframe: { src: string } }).iframe.src;
    expect(src).toBe(
      `/api/plugins/@acme/pet/ui/widget.html?v=${encodeURIComponent(uiStampOf(dir))}`,
    );
    // The URL the app frames is the one that may be kept forever.
    const served = await admin.get(src);
    expect(served.status).toBe(200);
    expect(served.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  });
});
