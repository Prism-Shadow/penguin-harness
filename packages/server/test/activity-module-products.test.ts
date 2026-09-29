/**
 * Opening a product Loom authored in the modules, in place: the project lists the products no
 * project has open, claims one, and its refs get Penguin's files beside Loom's, with Loom's
 * specification used as it is and its media bindings carried onto a plan made from it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type {
  ClaimModuleProductResponse,
  ModuleProductsResponse,
} from "../src/activities/module-product-types.js";
import { activitySpec, refFilesDir } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const FOLDER = "waf-module-sight-words";
const CODE = "sight-words";

async function write(file: string, content: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** A product Loom authored: a canonical, template-stable ref 1 with an image bound in media. */
async function loomProduct(root: string) {
  const product = path.join(root, "waf-checkout", "modules", FOLDER, "generated", CODE);
  await write(path.join(product, "spec", "activity_metadata.json"), {
    id: CODE,
    title: "Sight Words",
    moduleFolder: FOLDER,
    activityType: "standard",
    canonicalRefNum: 1,
    templateStable: true,
  });
  const ref = path.join(product, "refs", `${CODE}-1`, "spec");
  // Loom wrote an old spelling of the folder into this spec; the folder on disk wins.
  await write(path.join(ref, "activity_spec.json"), {
    ...activitySpec,
    moduleFolder: "wafmodule-sight-words",
    scenes: [
      {
        id: "intro",
        description: "Choose a word",
        media: { images: [{ key: "cover", description: "A cat on a mat" }] },
      },
    ],
  });
  await write(path.join(ref, "asset_manifest.json"), {
    productCode: CODE,
    refNum: 1,
    displayName: "Ref 1",
    assets: {
      "en-US": [
        {
          key: "cover",
          type: "image",
          description: "A cat on a mat",
          path: "media/loom/sight-words/sight-words-1/images/english/cover.png",
        },
      ],
    },
  });
  await write(path.join(ref, "activity_description.txt"), "Pick the word you hear.\n");
  await write(path.join(ref, "activity_metadata.json"), {
    id: CODE,
    refNum: 1,
    displayName: "The cat",
  });
}

describe("products in the modules, opened in place", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    await loomProduct(t.root);
    const client = async (user: string, projectId: string) => {
      const owner = await provisionUser(t.app, user);
      const api = apiClient(t.app, owner.cookie);
      expect((await api.post("/api/projects", { projectId })).status).toBe(201);
      return { api, base: `/api/projects/${projectId}/activities` };
    };
    return { t, client };
  }

  it("lists a product no project has open, and opens it with Loom's files kept", async () => {
    const { t, client } = await setup();
    const { api, base } = await client("opener", "opener-work");
    const listed = (await (
      await api.get(`${base}/module-products`)
    ).json()) as ModuleProductsResponse;
    expect(listed.products).toEqual([
      {
        moduleFolder: FOLDER,
        productCode: CODE,
        title: "Sight Words",
        activityType: "standard",
        refNums: [1],
      },
    ]);

    const claimed = await api.post(`${base}/module-products/claim`, {
      moduleFolder: FOLDER,
      productCode: CODE,
    });
    expect(claimed.status, await claimed.clone().text()).toBe(200);
    const result = (await claimed.json()) as ClaimModuleProductResponse;
    expect(result.activityIds).toHaveLength(1);
    expect(result.message).toContain("wafmodule-sight-words");

    const opened = (await (
      await api.get(`${base}/${result.activityIds[0]}`)
    ).json()) as ActivityDetail;
    expect(opened).toMatchObject({ refNum: 1, displayName: "The cat", stable: true });
    expect(opened.draft.status).toBe("valid");
    expect(opened.draft.description).toBe("Pick the word you hear.\n");
    expect(opened.draft.spec).toMatchObject({ moduleFolder: FOLDER, title: activitySpec.title });
    // Loom's binding is carried onto the plan Penguin made from the specification.
    expect(opened.draft.mediaPlan!.manifest.assets["en-US"]).toEqual([
      expect.objectContaining({
        key: "cover",
        path: "media/loom/sight-words/sight-words-1/images/english/cover.png",
      }),
    ]);
    const files = refFilesDir(t.root, CODE, 1);
    await fs.access(path.join(files, "penguin.json"));
    expect(
      JSON.parse(await fs.readFile(path.join(files, "asset_manifest.loom.json"), "utf8")),
    ).toMatchObject({ displayName: "Ref 1" });
    expect(
      JSON.parse(await fs.readFile(path.join(files, "activity_spec.loom.json"), "utf8")),
    ).toMatchObject({ moduleFolder: "wafmodule-sight-words" });
    const owner = JSON.parse(
      await fs.readFile(
        path.join(
          t.root,
          "waf-checkout",
          "modules",
          FOLDER,
          "generated",
          CODE,
          "spec",
          "penguin.json",
        ),
        "utf8",
      ),
    ) as { projectId: string };
    expect(owner.projectId).toBe("opener-work");
    // Open now, it is no longer offered.
    expect(
      ((await (await api.get(`${base}/module-products`)).json()) as ModuleProductsResponse)
        .products,
    ).toEqual([]);
    const again = await api.post(`${base}/module-products/claim`, {
      moduleFolder: FOLDER,
      productCode: CODE,
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "product_open" } });
  });

  it("puts back a ref that failed to open, and opens it when the product is opened again", async () => {
    const { t, client } = await setup();
    const { api, base } = await client("retrier", "retrier-work");
    // A second ref, whose opening fails: its bookkeeping cannot be written.
    const refs = path.join(t.root, "waf-checkout", "modules", FOLDER, "generated", CODE, "refs");
    await fs.cp(path.join(refs, `${CODE}-1`), path.join(refs, `${CODE}-2`), { recursive: true });
    const second = path.join(refs, `${CODE}-2`, "spec");
    await write(path.join(second, "asset_manifest.json"), {
      ...JSON.parse(await fs.readFile(path.join(second, "asset_manifest.json"), "utf8")),
      refNum: 2,
    });
    await write(path.join(second, "activity_metadata.json"), { id: CODE, refNum: 2 });
    await fs.mkdir(path.join(second, "penguin.json"));
    const claim = () =>
      api.post(`${base}/module-products/claim`, { moduleFolder: FOLDER, productCode: CODE });
    const listed = async () =>
      ((await (await api.get(`${base}/module-products`)).json()) as ModuleProductsResponse)
        .products;

    const first = await claim();
    expect(first.status, await first.clone().text()).toBe(200);
    const partly = (await first.json()) as ClaimModuleProductResponse;
    expect(partly.activityIds).toHaveLength(1);
    expect(partly.problems.join("\n")).toContain("Ref 2 was not opened");
    // Put back as Loom left it, and offered again with the ref still to open.
    await fs.access(path.join(second, "activity_spec.json"));
    expect(await listed()).toEqual([expect.objectContaining({ productCode: CODE, refNums: [2] })]);

    await fs.rm(path.join(second, "penguin.json"), { recursive: true, force: true });
    const retried = await claim();
    expect(retried.status, await retried.clone().text()).toBe(200);
    const rest = (await retried.json()) as ClaimModuleProductResponse;
    expect(rest.activityIds).toHaveLength(1);
    expect(rest.activityIds[0]).not.toBe(partly.activityIds[0]);
    expect((await api.get(`${base}/${rest.activityIds[0]}`)).status).toBe(200);
    expect(await listed()).toEqual([]);
    const again = await claim();
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "product_open" } });
  });

  it("keeps another project's product from being listed or claimed", async () => {
    const { client } = await setup();
    const first = await client("first", "first-work");
    expect(
      (
        await first.api.post(`${first.base}/module-products/claim`, {
          moduleFolder: FOLDER,
          productCode: CODE,
        })
      ).status,
    ).toBe(200);
    const second = await client("second", "second-work");
    expect(
      (
        (await (
          await second.api.get(`${second.base}/module-products`)
        ).json()) as ModuleProductsResponse
      ).products,
    ).toEqual([]);
    const refused = await second.api.post(`${second.base}/module-products/claim`, {
      moduleFolder: FOLDER,
      productCode: CODE,
    });
    expect(refused.status).toBe(409);
  });

  it("is claimed by an owner only", async () => {
    const { t, client } = await setup();
    const { api, base } = await client("keeper", "keeper-work");
    const member = await provisionUser(t.app, "visitor");
    expect(
      (await api.post("/api/projects/keeper-work/members", { userId: "visitor" })).status,
    ).toBe(201);
    const visitor = apiClient(t.app, member.cookie);
    expect((await visitor.get(`${base}/module-products`)).status).toBe(200);
    const refused = await visitor.post(`${base}/module-products/claim`, {
      moduleFolder: FOLDER,
      productCode: CODE,
    });
    expect(refused.status).toBe(403);
  });
});
