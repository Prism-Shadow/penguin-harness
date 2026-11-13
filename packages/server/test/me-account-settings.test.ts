/**
 * The Settings pages' preferences on the account: the known keys of PUT /api/me/prefs, and the
 * background image's own route.
 *
 * - Given the Settings pages' preferences, when they are written, then GET /api/me/prefs reads
 *   them back beside the other writers' keys; a write with one malformed preference is refused
 *   and stores nothing.
 * - Given a prefs write naming the background image's id, then it is refused: only the image
 *   route sets it.
 * - Given a background image, when it is stored, then the prefs carry its id, the image reads
 *   back, the same image keeps the same id, and another user sees none of it; when it is removed,
 *   then both the image and the id are gone. A malformed or oversized image is refused.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKGROUND_IMAGE_MAX_CHARS } from "../src/api/types.js";
import type {
  BackgroundImagePutResponse,
  BackgroundImageResponse,
  PrefsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

type Client = ReturnType<typeof apiClient>;

/** A real 1x1 RGBA PNG. */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

async function prefsOf(api: Client): Promise<PrefsResponse["prefs"]> {
  return ((await (await api.get("/api/me/prefs")).json()) as PrefsResponse).prefs;
}

async function imageOf(api: Client): Promise<BackgroundImageResponse> {
  return (await (await api.get("/api/me/background-image")).json()) as BackgroundImageResponse;
}

describe("the account's Settings preferences", () => {
  let t: TestApp;
  let ann: Client;
  let ben: Client;

  beforeEach(async () => {
    t = await createTestApp();
    ann = apiClient(t.app, (await provisionUser(t.app, "ann")).cookie);
    ben = apiClient(t.app, (await provisionUser(t.app, "ben")).cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("stores the preferences beside the other keys, and refuses a malformed one whole", async () => {
    await ann.put("/api/me/prefs", { lastProjectId: "ann-default_project" });
    const settings = {
      themeMode: "dark",
      themeId: "geek",
      lang: "en",
      currency: "CNY",
      toolAliases: false,
      notifications: true,
      background: { transparency: 40, mode: "tile", position: "center top" },
    };
    expect((await ann.put("/api/me/prefs", settings)).status).toBe(200);
    expect(await prefsOf(ann)).toEqual({ lastProjectId: "ann-default_project", ...settings });

    for (const bad of [
      { themeId: "two words" },
      { toolAliases: "yes" },
      { background: { transparency: 40, position: "center top" } },
    ]) {
      const res = await ann.put("/api/me/prefs", { lang: "zh", ...bad });
      expect(res.status).toBe(400);
    }
    expect((await prefsOf(ann)).lang).toBe("en");
  });

  it("refuses the background image's id through the prefs", async () => {
    const res = await ann.put("/api/me/prefs", { backgroundImageId: "forged" });
    expect(res.status).toBe(400);
    expect((await prefsOf(ann)).backgroundImageId).toBeUndefined();
  });

  it("keeps the background image apart, named by an id in the prefs", async () => {
    const put = await ann.put("/api/me/background-image", { image: PNG_1X1 });
    expect(put.status).toBe(200);
    const { imageId } = (await put.json()) as BackgroundImagePutResponse;
    expect(imageId).toEqual(expect.any(String));
    expect((await prefsOf(ann)).backgroundImageId).toBe(imageId);
    expect(await imageOf(ann)).toEqual({ image: PNG_1X1, imageId });
    // The same image again: nothing a browser compares has changed.
    const again = (await (
      await ann.put("/api/me/background-image", { image: PNG_1X1 })
    ).json()) as BackgroundImagePutResponse;
    expect(again.imageId).toBe(imageId);
    expect(await imageOf(ben)).toEqual({ image: null, imageId: null });

    for (const image of [
      "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      "https://example.com/wallpaper.png",
      `data:image/png;base64,${"A".repeat(BACKGROUND_IMAGE_MAX_CHARS)}`,
    ]) {
      expect((await ann.put("/api/me/background-image", { image })).status).toBe(400);
    }
    expect((await imageOf(ann)).image).toBe(PNG_1X1);

    const removed = await ann.put("/api/me/background-image", { image: null });
    expect(((await removed.json()) as BackgroundImagePutResponse).imageId).toBeNull();
    expect(await imageOf(ann)).toEqual({ image: null, imageId: null });
    expect((await prefsOf(ann)).backgroundImageId).toBeNull();
  });
});
