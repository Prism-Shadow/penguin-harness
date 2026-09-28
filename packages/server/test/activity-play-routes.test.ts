/**
 * Playing an imported Loom activity, over HTTP.
 *
 * An author asks the API to play an activity and is sent to a signed link on the preview
 * origin; everything the learner runtime then fetches -- its configuration, the module's
 * files, the media, the assessment -- hangs off that link and answers only to it. What this
 * proves is the whole path from a checkout on disk to the payload a runtime would load,
 * and that the link is the only credential and works only where it was issued.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activitySpec } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const FOLDER = "waf-module-sight-words";
const CODE = "sight-words";

async function write(file: string, content: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** A checkout holding one Loom product whose module Loom finished generating. */
async function checkout(options: { usesAssessment?: boolean } = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "waf-play-"));
  await write(path.join(root, "framework", "package.json"), { version: "9.9.9" });
  await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
  await write(path.join(root, "framework", "res", "common", "css", "style.css"), "body{}");
  await write(path.join(root, "media", "loom", CODE, "intro.mp3"), "intro sound");

  const spec = {
    ...activitySpec,
    runtime: { ...activitySpec.runtime, usesAssessment: options.usesAssessment ?? false },
  };
  const product = path.join(root, "modules", FOLDER, "generated", CODE);
  await write(path.join(product, "spec", "activity_metadata.json"), {
    title: "Sight Words",
    canonicalRefNum: 1,
    activityType: "standard",
    moduleFolder: FOLDER,
  });
  const ref = path.join(product, "refs", `${CODE}-1`, "spec");
  await write(path.join(ref, "activity_metadata.json"), { refNum: 1, title: "Sight Words 1" });
  await write(path.join(ref, "activity_spec.json"), spec);
  await write(path.join(ref, "asset_manifest.json"), { assets: { "en-US": [] } });
  await write(path.join(ref, "activity_description.txt"), "Ref 1");

  const module = path.join(root, "modules", FOLDER);
  await write(path.join(module, "definition.json"), {
    id: "sightWords",
    require: {
      entry: { type: "javascript", url: "entry.js" },
      layout: { type: "html", url: "layout.html" },
    },
    themes: { park: { assets: {}, properties: {} } },
  });
  await write(path.join(module, "package.json"), { version: "1.0.0" });
  await write(path.join(module, "res", "layout.html"), "<div>layout</div>");
  await write(path.join(module, "configurations", `${CODE}-1.json`), {
    sightWords: { intro: "{{MEDIA}}/loom/sight-words/intro.mp3" },
  });
  await write(path.join(module, "assessments", `${CODE}-1.json`), {
    configuration: { nextItemsSize: 1 },
    items: [{ title: "first", configuration: { simpleChoice: [] } }, { title: "second" }],
  });
  return root;
}

describe("playing an imported activity", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(options: Parameters<typeof checkout>[0] = {}) {
    const root = await checkout(options);
    const previous = process.env.WAF_ROOT_DIR;
    process.env.WAF_ROOT_DIR = root;
    const t = await createTestApp();
    cleanups.push(async () => {
      if (previous === undefined) delete process.env.WAF_ROOT_DIR;
      else process.env.WAF_ROOT_DIR = previous;
      await t.cleanup();
      await fs.rm(root, { recursive: true, force: true });
    });
    const owner = await provisionUser(t.app, "play_owner");
    const client = apiClient(t.app, owner.cookie);
    const projectId = "play_owner-play";
    await client.post("/api/projects", { projectId, name: "Play" });
    const imported = await client.post(`/api/projects/${projectId}/activities/import`, {
      moduleFolder: FOLDER,
      productCode: CODE,
    });
    expect(imported.status).toBe(200);
    const list = (await (await client.get(`/api/projects/${projectId}/activities`)).json()) as {
      activities: { id: string }[];
    };
    const activityId = list.activities[0]!.id;

    const redirect = await client.get(
      `/api/projects/${projectId}/activities/${activityId}/sandbox/play?language=en-US`,
    );
    const location = new URL(redirect.headers.get("location")!);
    const base = location.pathname.slice(0, location.pathname.lastIndexOf("/") + 1);
    /** A request on the host the link was issued for, with no cookie at all. */
    const onPreview = (pathname: string, init: RequestInit = {}) =>
      t.app.request(new URL(pathname, location.origin).toString(), {
        ...init,
        headers: { host: location.host, ...(init.headers ?? {}) },
      });
    return { t, client, redirect, location, base, onPreview, projectId, activityId };
  }

  it("sends an author to a signed link on the preview origin", async () => {
    const { redirect, location } = await setup();
    expect(redirect.status).toBe(302);
    expect(location.hostname).toBe("127.0.0.1");
    expect(location.pathname).toMatch(/^\/preview\/activity\/[^/]+\/play$/);
    expect(location.searchParams.get("language")).toBe("en-US");
  });

  it("signs the App origin that asked into the link, for the page to report its state to", async () => {
    const { location } = await setup();
    const token = location.pathname.split("/")[3]!;
    const body = JSON.parse(
      Buffer.from(token.slice(0, token.indexOf(".")), "base64url").toString("utf8"),
    ) as { parentOrigin?: string };
    expect(body.parentOrigin).toBe("http://localhost");
  });

  it("answers the framework's configuration request with the activity, under the link", async () => {
    const { base, onPreview } = await setup();
    const response = await onPreview(
      `${base}activity/v3/configuration/activities/sightWords/version/1`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { attributes: { activity: Record<string, any> } };
    };
    const activity = body.data.attributes.activity;
    expect(activity.layout.compartments.main.require.entry.url).toBe(`${base}module/entry.js`);
    expect(activity.configuration.sightWords.intro).toBe(`${base}media/loom/sight-words/intro.mp3`);
    // No navbar module in this checkout: declared empty, never omitted.
    expect(activity.layout.compartments.navBar).toEqual({ id: "navBar" });
  });

  it("serves the module's files and the checkout's media without a session", async () => {
    const { base, onPreview } = await setup();
    const layout = await onPreview(`${base}module/layout.html`);
    expect(layout.status).toBe(200);
    expect(await layout.text()).toBe("<div>layout</div>");
    const media = await onPreview(`${base}media/loom/sight-words/intro.mp3`);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("audio/mpeg");
    expect(await media.text()).toBe("intro sound");
    const css = await onPreview(`${base}css/style.css`);
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("does not hand out Loom's authoring files through the module route", async () => {
    const { base, onPreview } = await setup();
    const response = await onPreview(`${base}module/generated/${CODE}/spec/activity_metadata.json`);
    expect(response.status).toBe(400);
  });

  it("refuses the link on any other host, and a link that was tampered with", async () => {
    const { base, t, location } = await setup();
    const elsewhere = await t.app.request(
      new URL(`${base}module/layout.html`, "http://localhost").toString(),
      { headers: { host: "localhost" } },
    );
    expect(elsewhere.status).toBe(404);
    const forged = await t.app.request(
      new URL("/preview/activity/forged.token/module/layout.html", location.origin).toString(),
      { headers: { host: location.host } },
    );
    expect(forged.status).toBe(404);
  });

  it("allows the sandboxed page's cross-origin requests, which carry no credential", async () => {
    const { base, onPreview } = await setup();
    const preflight = await onPreview(`${base}activity/v3/configuration/activities/x/version/1`, {
      method: "OPTIONS",
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    const layout = await onPreview(`${base}module/layout.html`);
    expect(layout.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("shows why there is nothing to play when the module does not build", async () => {
    // The fixture has no webpack anywhere; the page says so with the build's own output.
    const { location, onPreview } = await setup();
    const page = await onPreview(location.pathname);
    expect(page.status).toBe(500);
    expect(await page.text()).toContain("did not build");
  });

  it("plays an assessment through, one part at a time", async () => {
    const { base, onPreview } = await setup({ usesAssessment: true });
    const at = `${base}assessment/v3/apps/a/assessments/sightWords/versions/1/orgs/o/students/s/assess`;
    const post = (url: string, data: unknown[] = []) =>
      onPreview(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data }),
      });
    const first = (await (await post(at)).json()) as Record<string, any>;
    expect(first.status).toBe("IN_PROGRESS");
    expect(first.nextItems[0].title).toBe("first");
    const second = (await (
      await post(`${at}/${first.assessmentScoreId}`, [{ item_score_id: 1 }])
    ).json()) as Record<string, any>;
    expect(second.nextItems[0].title).toBe("second");
    const done = (await (await post(`${at}/${first.assessmentScoreId}`)).json()) as Record<
      string,
      any
    >;
    expect(done.status).toBe("FINISHED");
    // A finished session is gone.
    expect((await post(`${at}/${first.assessmentScoreId}`)).status).toBe(404);
  });
});
