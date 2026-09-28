/**
 * The migration trial: real, already-shipped Loom activities imported into a real Penguin
 * store, over HTTP, and read back.
 *
 * This is the gate on switching Loom off, so it runs against the actual checkout rather
 * than a fixture. When there is no checkout on the machine it skips — the fixture-based
 * `activity-import-api.test.ts` covers the behaviour; what this adds is that the behaviour
 * holds for data nobody wrote for it.
 *
 * Three products, chosen for what they stress rather than for passing:
 *   r2phcs03L   one ref, two language groups — multi-language arrives through the manifest
 *   lang1       all three supported languages
 *   r2pt01      a decodable book with ten refs — the product level under real load
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverLoomProducts, type ImportedActivity } from "../src/activities/loom-import.js";
import { mapImport } from "../src/activities/import-mapping.js";
import { findWafRoot } from "../src/activities/waf-module.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const wafRoot = await findWafRoot();
const corpus: ImportedActivity[] = wafRoot
  ? await discoverLoomProducts(path.join(wafRoot, "modules"))
  : [];
const find = (productCode: string) =>
  corpus.find((entry) => entry.product.productCode === productCode);

const TRIAL = ["r2phcs03L", "lang1", "r2pt01"];
const available = wafRoot !== null && TRIAL.every((code) => find(code));

describe.skipIf(!available)("the migration trial, against the real checkout", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function project(name: string) {
    const previous = process.env.WAF_ROOT_DIR;
    process.env.WAF_ROOT_DIR = wafRoot!;
    const t = await createTestApp();
    cleanups.push(async () => {
      if (previous === undefined) delete process.env.WAF_ROOT_DIR;
      else process.env.WAF_ROOT_DIR = previous;
      await t.cleanup();
    });
    const owner = await provisionUser(t.app, name);
    const client = apiClient(t.app, owner.cookie);
    const projectId = `${name}-trial`;
    const created = await client.post("/api/projects", { projectId, name: "Trial" });
    if (created.status !== 201)
      throw new Error(`project create: ${created.status} ${await created.text()}`);
    return { client, projectId };
  }

  /** Import one real product and read back every ref it created. */
  async function roundTrip(user: string, productCode: string) {
    const source = find(productCode)!;
    const { client, projectId } = await project(user);
    const response = await client.post(`/api/projects/${projectId}/activities/import`, {
      moduleFolder: source.product.moduleFolder,
      productCode,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      outcome: { created: number[]; failed: unknown[]; partial: unknown[] };
      mapping: { dropped: string[] };
    };
    const activities = (await (
      await client.get(`/api/projects/${projectId}/activities`)
    ).json()) as { activities: { id: string; refNum: number; title: string }[] };
    const drafts = new Map<number, { spec: unknown; description: string; status: string }>();
    for (const activity of activities.activities) {
      const detail = (await (
        await client.get(`/api/projects/${projectId}/activities/${activity.id}`)
      ).json()) as { draft: { spec: unknown; description: string; status: string } };
      drafts.set(activity.refNum, detail.draft);
    }
    return { source, mapping: mapImport(source.product, source.refs), body, drafts };
  }

  it("carries a two-language activity with its specification intact", async () => {
    const { mapping, body, drafts } = await roundTrip("trial_lang", "r2phcs03L");
    expect(body.mapping.dropped).toEqual([]);
    expect(body.outcome.failed).toEqual([]);
    expect(body.outcome.partial).toEqual([]);

    for (const activity of mapping.activities) {
      const draft = drafts.get(activity.refNum)!;
      // What Penguin stored is what the mapping said it would store, to the byte.
      expect(draft.spec).toEqual(activity.spec);
      expect(draft.description).toBe(activity.description);
      expect(draft.status).toBe("valid");
    }
    expect(mapping.activities[0]!.languages).toEqual(["en-US", "es-MX"]);

    // Media arrives bound as Loom had it: both languages, their recordings, their words.
    const plan = (
      drafts.get(mapping.activities[0]!.refNum) as {
        mediaPlan?: {
          manifest: {
            assets: Record<
              string,
              { key: string; type: string; path?: string; wordTimings?: unknown[] }[]
            >;
          };
        };
      }
    ).mediaPlan;
    expect(Object.keys(plan?.manifest.assets ?? {}).sort()).toEqual(["en-US", "es-MX"]);
    for (const language of ["en-US", "es-MX"]) {
      const narration = plan!.manifest.assets[language]!.filter((asset) => asset.type === "audio");
      expect(narration.length, language).toBeGreaterThan(0);
      expect(
        narration.filter((asset) => !asset.path?.startsWith("media/")).map((asset) => asset.key),
        language,
      ).toEqual([]);
      expect(
        narration.some((asset) => asset.wordTimings?.length),
        language,
      ).toBe(true);
    }
  });

  it("carries all three supported languages", async () => {
    const { mapping, body } = await roundTrip("trial_three", "lang1");
    expect(body.mapping.dropped).toEqual([]);
    expect(mapping.activities[0]!.languages).toEqual(["en-US", "es-MX", "ro-RO"]);
  });

  it("lets an author edit an imported activity like any other", async () => {
    // The bar is not only that an import lands: an imported activity has to be ordinary
    // afterwards, or authoring in Penguin means re-authoring.
    const { client, projectId } = await project("trial_edit");
    const source = find("r2phcs03L")!;
    await client.post(`/api/projects/${projectId}/activities/import`, {
      moduleFolder: source.product.moduleFolder,
      productCode: "r2phcs03L",
    });
    const activities = (await (
      await client.get(`/api/projects/${projectId}/activities`)
    ).json()) as { activities: { id: string }[] };
    const activityId = activities.activities[0]!.id;
    const before = (await (
      await client.get(`/api/projects/${projectId}/activities/${activityId}`)
    ).json()) as { draft: { contentRevision: string; spec: Record<string, unknown> } };

    const edited = await client.post(
      `/api/projects/${projectId}/activities/${activityId}/apply-generated-spec`,
      {
        spec: { ...before.draft.spec, title: "Edited by an author" },
        expectedRevision: before.draft.contentRevision,
      },
    );
    expect(edited.status).toBe(200);
    const after = (await (
      await client.get(`/api/projects/${projectId}/activities/${activityId}`)
    ).json()) as { title: string; draft: { spec: { title: string }; status: string } };
    expect(after.draft.spec.title).toBe("Edited by an author");
    expect(after.draft.status).toBe("valid");
    expect(after.title).toBe("Edited by an author");
  });

  it("carries a ten-ref book, with the module staying on the ref Loom named", async () => {
    const { source, mapping, body, drafts } = await roundTrip("trial_book", "r2pt01");
    expect(body.outcome.failed).toEqual([]);
    expect(body.outcome.partial).toEqual([]);
    expect(body.outcome.created).toHaveLength(source.refs.length);
    // The canonical ref is created first: it is the only ref allowed to change the module.
    expect(body.outcome.created[0]).toBe(mapping.product.canonicalRefNum);

    for (const activity of mapping.activities) {
      const draft = drafts.get(activity.refNum)!;
      expect(draft.spec).toEqual(activity.spec);
      expect(draft.description).toBe(activity.description);
    }
    expect(mapping.product.activityType).toBe("book");
    expect(mapping.product.bookMode).toBe("decodable");
  });
});
