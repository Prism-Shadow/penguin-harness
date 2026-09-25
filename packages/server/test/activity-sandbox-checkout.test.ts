/**
 * Previewing a module Loom left in the WAF checkout.
 *
 * An imported activity has no module run of its own: its module is the folder Loom
 * generated under `modules/`, and its media sits under the checkout's `media/`. What this
 * covers is that the sandbox finds both there, never writes to the checkout, and still
 * prefers what Penguin built itself -- plus the signed link a played preview is served
 * behind.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxBuilder } from "../src/activities/sandbox-builder.js";
import { ActivitySandboxService } from "../src/activities/sandbox-service.js";
import { checkoutOutputRoot } from "../src/activities/sandbox-source.js";

const PROJECT = "proj";
const ACTIVITY = "act_1";
const FOLDER = "waf-module-sight-words";

const spec = {
  id: "sight-words",
  title: "Sight Words",
  runtime: { engine: "html", layout: "mainOnly", theme: "park", resolution: "640x480" },
  scenes: [{ id: "intro" }],
};

async function write(file: string, content: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** A checkout with one Loom module and its media, a Penguin root, and a service over both. */
async function setup(options: { runs?: boolean; canonical?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-checkout-"));
  const penguin = path.join(root, "penguin");
  const waf = path.join(root, "waf");
  const moduleRoot = path.join(waf, "modules", FOLDER);
  await write(path.join(moduleRoot, "definition.json"), {
    id: "sightWords",
    require: {
      entry: { type: "javascript", url: "entry.js" },
      layout: { type: "html", url: "layout.html" },
      font: { type: "css", url: "{{MEDIA}}/fonts/Waterford.css" },
    },
    themes: {
      park: {
        assets: { cover: { type: "image", url: "{{MEDIA}}/loom/sight-words/cover.jpg" } },
        properties: {},
      },
    },
  });
  await write(path.join(moduleRoot, "package.json"), { version: "1.0.17" });
  await write(path.join(moduleRoot, "configurations", "sight-words-1.json"), {
    sightWords: { intro: { audio: "{{MEDIA}}/loom/sight-words/intro.mp3" } },
  });
  await write(path.join(moduleRoot, "res", "layout.html"), "<div>checkout layout</div>");
  await write(path.join(moduleRoot, "src", "index.js"), "module.exports = {};");
  await write(path.join(moduleRoot, "generated", "sight-words", "spec", "notes.json"), {});
  await write(path.join(waf, "media", "loom", "sight-words", "cover.jpg"), "checkout cover");
  await write(path.join(penguin, "drafts", "media", "loom", "sight-words", "intro.mp3"), "draft");

  if (options.runs) {
    const runModule = path.join(penguin, "activity-runs", "run_1", "module");
    await write(path.join(runModule, "definition.json"), {
      id: "sightWords",
      require: { entry: { type: "javascript", url: "entry.js" } },
      themes: { park: { assets: {}, properties: { from: "penguin" } } },
    });
  }

  const activity = {
    id: ACTIVITY,
    collectionId: "col",
    productCode: "sight-words",
    refNum: 1,
    title: "Sight Words",
    draft: { draftId: "d", status: "valid", spec, contentRevision: "rev0123456789abcdef" },
  };
  const service = new ActivitySandboxService();
  Object.assign(service, {
    activities: {
      getActivity: async () => activity,
      isCanonicalRef: () => options.canonical ?? true,
      effectiveModuleDocument: async () => null,
      productOf: () => ({ moduleFolder: FOLDER, canonicalRefNum: 1 }),
      draftWorkspace: () => path.join(penguin, "drafts"),
    },
    generation: {
      list: async () =>
        options.runs
          ? [{ runId: "run_1", kind: "module", status: "succeeded", createdAt: "2026-09-01" }]
          : [],
    },
    config: { root: penguin },
    locateWafRoot: async () => waf,
  });
  return { service, root, penguin, waf, moduleRoot };
}

describe("previewing a module from the WAF checkout", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  });
  async function made(options?: Parameters<typeof setup>[0]) {
    const result = await setup(options);
    roots.push(result.root);
    return result;
  }

  it("composes the payload from the checkout when Penguin has built nothing", async () => {
    const { service } = await made();
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    expect(payload.id).toBe("preview:sightWords");
    const main = payload.layout.compartments.main as unknown as {
      require: Record<string, { url: string }>;
      assets: Record<string, { url: string }>;
    };
    const base = "/api/projects/proj/activities/act_1/sandbox/";
    expect(main.require.entry!.url).toBe(`${base}module/entry.js`);
    // Media is the media root, not a module file: the token is resolved, never prefixed.
    expect(main.require.font!.url).toBe(`${base}media/fonts/Waterford.css`);
    expect(main.assets.cover!.url).toBe(`${base}media/loom/sight-words/cover.jpg`);
    expect(payload.configuration.sightWords).toEqual({
      intro: { audio: `${base}media/loom/sight-words/intro.mp3` },
    });
  });

  it("hangs every URL off the base a played preview passes", async () => {
    const { service } = await made();
    const payload = await service.payload(PROJECT, ACTIVITY, { base: "/preview/activity/t/" });
    const main = payload.layout.compartments.main as unknown as {
      require: Record<string, { url: string }>;
    };
    expect(main.require.entry!.url).toBe("/preview/activity/t/module/entry.js");
    expect(main.require.font!.url).toBe("/preview/activity/t/media/fonts/Waterford.css");
  });

  it("declares the checkout's navigation bar, in its park theme, as Loom did", async () => {
    const { service, waf } = await made();
    const navbar = path.join(waf, "modules", "navbar");
    await write(path.join(navbar, "definition.json"), {
      id: "Navigation Bar",
      require: {
        entry: { type: "javascript", url: "entry.js" },
        font: { type: "css", url: "{{MEDIA}}/fonts/Dimbo.css" },
      },
      themes: { park: { assets: {}, properties: { theme: "park" } } },
    });
    await write(path.join(navbar, "configurations", "none_navBar.json"), { shown: true });
    const payload = await service.payload(PROJECT, ACTIVITY, { base: "/b/" });
    const compartment = payload.layout.compartments.navBar as unknown as {
      id: string;
      require: Record<string, { url: string }>;
    };
    expect(compartment.id).toBe("Navigation Bar");
    expect(compartment.require.entry!.url).toBe("/b/navbar/entry.js");
    expect(compartment.require.font!.url).toBe("/b/media/fonts/Dimbo.css");
    expect(payload.configuration["Navigation Bar"]).toEqual({ shown: true });
    const served = await service.navbarFile("definition.json");
    expect(JSON.parse(Buffer.from(served.body!).toString("utf8")).id).toBe("Navigation Bar");
  });

  it("prefers the module Penguin built over the one in the checkout", async () => {
    const { service } = await made({ runs: true });
    const payload = await service.payload(PROJECT, ACTIVITY, {});
    const main = payload.layout.compartments.main as unknown as {
      properties: Record<string, unknown>;
    };
    expect(main.properties.from).toBe("penguin");
  });

  it("serves the build output first, then res, then the module folder", async () => {
    const { service, penguin } = await made();
    await write(path.join(checkoutOutputRoot(penguin, FOLDER), "entry.js"), "built entry");
    const text = async (file: string) =>
      Buffer.from((await service.moduleFile(PROJECT, ACTIVITY, file)).body!).toString("utf8");
    expect(await text("entry.js")).toBe("built entry");
    expect(await text("layout.html")).toBe("<div>checkout layout</div>");
    expect(JSON.parse(await text("package.json")).version).toBe("1.0.17");
  });

  it("does not serve Loom's authoring files from the module folder", async () => {
    const { service } = await made();
    await expect(
      service.moduleFile(PROJECT, ACTIVITY, "generated/sight-words/spec/notes.json"),
    ).rejects.toThrow("not a module file");
  });

  it("serves the draft's media first and the checkout's when the draft has none", async () => {
    const { service } = await made();
    const body = async (file: string) =>
      Buffer.from((await service.media(PROJECT, ACTIVITY, file, {})).body!).toString("utf8");
    expect(await body("loom/sight-words/intro.mp3")).toBe("draft");
    expect(await body("loom/sight-words/cover.jpg")).toBe("checkout cover");
    await expect(service.media(PROJECT, ACTIVITY, "loom/missing.jpg", {})).rejects.toThrow(
      "No media file",
    );
  });

  it("refuses a media path that climbs out of both roots", async () => {
    const { service } = await made();
    await expect(
      service.media(PROJECT, ACTIVITY, "..%2Fmodules%2Fwaf-module-sight-words%2Fpackage.json", {}),
    ).rejects.toThrow("not a media path");
  });

  it("reports a checkout module as needing a build until its output exists", async () => {
    const { service, penguin } = await made();
    expect((await service.status(PROJECT, ACTIVITY)).state).toBe("stale");
    // Written after the sources, as a build would be.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await write(path.join(checkoutOutputRoot(penguin, FOLDER), "entry.js"), "built");
    expect((await service.status(PROJECT, ACTIVITY)).state).toBe("ready");
  });

  it("lets any ref build a checkout module, into Penguin's directory", async () => {
    const { service, moduleRoot } = await made({ canonical: false });
    const built: string[] = [];
    Object.assign(service, {
      checkoutBuilder: new SandboxBuilder({
        build: async (workspace) => {
          built.push(workspace);
          return { ok: true, log: "compiled" };
        },
        sources: async () => [Date.now()],
        now: () => Date.now(),
      }),
    });
    const result = await service.build(PROJECT, ACTIVITY, true);
    expect(result.ok).toBe(true);
    expect(built).toEqual([moduleRoot]);
  });

  it("never writes to the checkout while reading it", async () => {
    const { service, waf } = await made();
    const before = await fs.readdir(path.join(waf, "modules", FOLDER), { recursive: true });
    await service.payload(PROJECT, ACTIVITY, {});
    await service.status(PROJECT, ACTIVITY);
    await service.moduleFile(PROJECT, ACTIVITY, "layout.html");
    const after = await fs.readdir(path.join(waf, "modules", FOLDER), { recursive: true });
    expect(after.sort()).toEqual(before.sort());
  });
});

describe("the link a played preview is served behind", () => {
  const service = new ActivitySandboxService();
  Object.assign(service, {
    activities: { getActivity: async () => ({ id: ACTIVITY }) },
  });

  it("grants one activity on the host it was issued for", async () => {
    const { token } = await service.play(PROJECT, ACTIVITY, "127.0.0.1", false);
    expect(service.verifyPlay(token, "127.0.0.1")).toMatchObject({
      projectId: PROJECT,
      activityId: ACTIVITY,
      shared: false,
    });
  });

  it("refuses the link on any other host", async () => {
    const { token } = await service.play(PROJECT, ACTIVITY, "127.0.0.1", false);
    expect(service.verifyPlay(token, "localhost")).toBeNull();
  });

  it("refuses a link whose contents were changed", async () => {
    const { token } = await service.play(PROJECT, ACTIVITY, "127.0.0.1", false);
    const [body, mac] = token.split(".");
    const altered = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    altered.activityId = "someone_else";
    const forged = `${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${mac}`;
    expect(service.verifyPlay(forged, "127.0.0.1")).toBeNull();
    expect(service.verifyPlay("not-a-token", "127.0.0.1")).toBeNull();
  });

  it("refuses a link another server signed", async () => {
    const other = new ActivitySandboxService();
    Object.assign(other, { activities: { getActivity: async () => ({ id: ACTIVITY }) } });
    const { token } = await other.play(PROJECT, ACTIVITY, "127.0.0.1", false);
    expect(service.verifyPlay(token, "127.0.0.1")).toBeNull();
  });
});
