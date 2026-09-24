/**
 * The project media library: one listing of every live activity's uploads, a zip of a
 * chosen few that any member may download, and a copy of one activity's upload into
 * another.
 */
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type { ProjectMediaListing } from "../src/activities/media-library-types.js";
import type { UploadedMedia } from "../src/activities/upload.js";
import { bundleEntryNames, copiedUploadName } from "../src/activities/media-bundle.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

// A bundle limit small enough to cross with a few test files. Everything else is real.
vi.mock("../src/activities/media-bundle.js", async (original) => ({
  ...(await original<typeof import("../src/activities/media-bundle.js")>()),
  BUNDLE_MAX_BYTES: 400,
}));

const png = (fill: number, padding = 0) =>
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(4),
    Buffer.from("IHDR", "ascii"),
    Buffer.alloc(16, fill),
    Buffer.alloc(padding),
  ]);
const wav = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.alloc(4),
  Buffer.from("WAVE", "ascii"),
  Buffer.alloc(16),
]);

describe("bundle naming", () => {
  it("keeps the first name and numbers the ones after it", () => {
    expect(bundleEntryNames(["cat.png", "dog.png", "cat.png", "cat.png", "CAT.png"])).toEqual([
      "cat.png",
      "dog.png",
      "cat-2.png",
      "cat-3.png",
      "CAT-4.png",
    ]);
    expect(bundleEntryNames(["noext", "noext"])).toEqual(["noext", "noext-2"]);
  });

  it("drops the digest this server added, so a copy lands on the same path", () => {
    expect(copiedUploadName("media/uploads/cat-1f3a9c2b1f3a9c2b.png")).toBe("cat.png");
    expect(copiedUploadName(`media/uploads/cat-${"a".repeat(64)}.png`)).toBe("cat.png");
    expect(copiedUploadName("media/uploads/my-cat.png")).toBe("my-cat.png");
  });
});

describe("project media library API", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "librarian");
    const client = apiClient(t.app, owner.cookie);
    for (const id of ["librarian-one", "librarian-two"])
      expect((await client.post("/api/projects", { projectId: id })).status).toBe(201);
    const base = (projectId = "librarian-one") => `/api/projects/${projectId}/activities`;
    const create = async (productCode: string, refNum: number, projectId = "librarian-one") => {
      const response = await client.post(base(projectId), {
        productCode,
        refNum,
        title: `${productCode} ${refNum}`,
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as ActivityDetail;
    };
    const upload = async (
      activity: ActivityDetail,
      name: string,
      bytes: Buffer,
      projectId = "librarian-one",
    ) => {
      const response = await client.post(`${base(projectId)}/${activity.id}/media-uploads`, {
        name,
        dataBase64: bytes.toString("base64"),
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as UploadedMedia;
    };
    return { t, client, base, create, upload };
  }

  it("lists every live activity's uploads, and nothing from archived activities or other projects", async () => {
    const { client, base, create, upload } = await setup();
    const one = await create("words", 1);
    const two = await create("letters", 3);
    const gone = await create("count", 1);
    const elsewhere = await create("words", 1, "librarian-two");
    const cat = await upload(one, "cat.png", png(1));
    const bell = await upload(two, "bell.wav", wav);
    await upload(gone, "gone.png", png(2));
    await upload(elsewhere, "other.png", png(3), "librarian-two");
    expect((await client.delete(`${base()}/${gone.id}`)).status).toBe(204);

    const response = await client.get(`${base()}/media-library`);
    expect(response.status).toBe(200);
    const listing = (await response.json()) as ProjectMediaListing;
    expect(listing.truncated).toBe(false);
    expect(listing.files.map((file) => [file.activityId, file.path]).sort()).toEqual(
      [
        [one.id, cat.path],
        [two.id, bell.path],
      ].sort(),
    );
    expect(listing.files.find((file) => file.path === bell.path)).toMatchObject({
      kind: "audio",
      activityTitle: "letters 3",
      productCode: "letters",
      refNum: 3,
      byteLength: wav.byteLength,
    });
  });

  it("zips the chosen files, numbers repeated names, and refuses bad selections", async () => {
    const { client, base, create, upload } = await setup();
    const one = await create("words", 1);
    const two = await create("words", 2);
    const cat = await upload(one, "cat.png", png(1));
    const bell = await upload(one, "bell.wav", wav);
    // The same bytes under the same name in another activity: the same stored name.
    const sameCat = await upload(two, "cat.png", png(1));
    expect(sameCat.path).toBe(cat.path);

    const bundle = await client.post(`${base()}/media-library/bundle`, {
      items: [
        { activityId: one.id, path: cat.path },
        { activityId: one.id, path: bell.path },
        { activityId: two.id, path: sameCat.path },
      ],
    });
    expect(bundle.status, await bundle.clone().text()).toBe(200);
    expect(bundle.headers.get("content-type")).toBe("application/zip");
    expect(bundle.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''media-library-selection.zip",
    );
    expect(bundle.headers.get("x-content-type-options")).toBe("nosniff");
    const entries = unzipSync(new Uint8Array(await bundle.arrayBuffer()));
    const catName = cat.path.slice("media/uploads/".length);
    const bellName = bell.path.slice("media/uploads/".length);
    expect(Object.keys(entries).sort()).toEqual(
      [catName, bellName, catName.replace(/\.png$/, "-2.png")].sort(),
    );
    expect(Buffer.from(entries[bellName]!)).toEqual(wav);

    const post = (items: unknown) => client.post(`${base()}/media-library/bundle`, { items });
    expect((await post([])).status).toBe(400);
    expect(
      (await post(Array.from({ length: 61 }, () => ({ activityId: one.id, path: cat.path }))))
        .status,
    ).toBe(400);
    expect((await post([{ activityId: one.id }])).status).toBe(400);
    // Outside the uploads directory, or not there at all.
    expect((await post([{ activityId: one.id, path: "media/images/cat.png" }])).status).toBe(404);
    expect((await post([{ activityId: one.id, path: "media/uploads/../draft.json" }])).status).toBe(
      404,
    );
    expect((await post([{ activityId: one.id, path: "media/uploads/missing.png" }])).status).toBe(
      404,
    );
    // An activity of another project is not found from this one.
    const elsewhere = await create("words", 1, "librarian-two");
    const theirs = await upload(elsewhere, "theirs.png", png(4), "librarian-two");
    expect((await post([{ activityId: elsewhere.id, path: theirs.path }])).status).toBe(404);
  });

  it("refuses a bundle larger than the limit before reading it", async () => {
    const { client, base, create, upload } = await setup();
    const one = await create("words", 1);
    const big: UploadedMedia[] = [];
    for (const fill of [1, 2, 3]) big.push(await upload(one, `big-${fill}.png`, png(fill, 150)));
    const response = await client.post(`${base()}/media-library/bundle`, {
      items: big.map((file) => ({ activityId: one.id, path: file.path })),
    });
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "bundle_too_large",
    );
  });

  it("lets a project member list and download, but not copy", async () => {
    const { t, client, base, create, upload } = await setup();
    const one = await create("words", 1);
    const two = await create("words", 2);
    const cat = await upload(one, "cat.png", png(1));
    const member = await provisionUser(t.app, "library_reader");
    expect(
      (await client.post("/api/projects/librarian-one/members", { userId: "library_reader" }))
        .status,
    ).toBe(201);
    const reader = apiClient(t.app, member.cookie);
    expect((await reader.get(`${base()}/media-library`)).status).toBe(200);
    const bundle = await reader.post(`${base()}/media-library/bundle`, {
      items: [{ activityId: one.id, path: cat.path }],
    });
    expect(bundle.status).toBe(200);
    expect(Object.keys(unzipSync(new Uint8Array(await bundle.arrayBuffer())))).toHaveLength(1);
    expect(
      (
        await reader.post(`${base()}/${two.id}/media-uploads/copy`, {
          fromActivityId: one.id,
          path: cat.path,
        })
      ).status,
    ).toBe(403);
    // Someone outside the project does not see it at all.
    const stranger = apiClient(t.app, (await provisionUser(t.app, "stranger")).cookie);
    expect((await stranger.get(`${base()}/media-library`)).status).toBe(404);
    expect(
      (
        await stranger.post(`${base()}/media-library/bundle`, {
          items: [{ activityId: one.id, path: cat.path }],
        })
      ).status,
    ).toBe(404);
  });

  it("copies another activity's upload into this one, with the same bytes", async () => {
    const { client, base, create, upload } = await setup();
    const one = await create("words", 1);
    const two = await create("words", 2);
    const cat = await upload(one, "cat.png", png(1));
    const copied = await client.post(`${base()}/${two.id}/media-uploads/copy`, {
      fromActivityId: one.id,
      path: cat.path,
    });
    expect(copied.status, await copied.clone().text()).toBe(201);
    const stored = (await copied.json()) as UploadedMedia;
    expect(stored).toMatchObject({ path: cat.path, kind: "image", sha256: cat.sha256 });
    const listed = (await (await client.get(`${base()}/${two.id}/media-uploads`)).json()) as {
      media: UploadedMedia[];
    };
    expect(listed.media.map((file) => file.path)).toEqual([cat.path]);
    const bytes = await client.get(
      `${base()}/${two.id}/media-upload?path=${encodeURIComponent(stored.path)}`,
    );
    expect(Buffer.from(await bytes.arrayBuffer())).toEqual(png(1));
    // Copying again reuses the file; a missing source or another project's activity is refused.
    expect(
      (
        await client.post(`${base()}/${two.id}/media-uploads/copy`, {
          fromActivityId: one.id,
          path: cat.path,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await client.post(`${base()}/${two.id}/media-uploads/copy`, {
          fromActivityId: one.id,
          path: "media/uploads/missing.png",
        })
      ).status,
    ).toBe(404);
    const elsewhere = await create("words", 1, "librarian-two");
    const theirs = await upload(elsewhere, "theirs.png", png(4), "librarian-two");
    expect(
      (
        await client.post(`${base()}/${two.id}/media-uploads/copy`, {
          fromActivityId: elsewhere.id,
          path: theirs.path,
        })
      ).status,
    ).toBe(404);
  });
});
