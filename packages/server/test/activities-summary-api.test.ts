import { afterEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

describe("activity list summaries", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("adds a summary per activity only when asked", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "summary_owner");
    const client = apiClient(t.app, owner.cookie);
    await client.post("/api/projects", { projectId: "summary_owner-p", name: "P" });
    const first = await client.post("/api/projects/summary_owner-p/activities", {
      productCode: "ants",
      refNum: 1,
      title: "Counting ants",
    });
    const second = await client.post("/api/projects/summary_owner-p/activities", {
      productCode: "ants",
      refNum: 2,
      title: "Ants at night",
    });
    const firstId = ((await first.json()) as { id: string }).id;
    const secondId = ((await second.json()) as { id: string }).id;

    const plain = (await (await client.get("/api/projects/summary_owner-p/activities")).json()) as {
      summaries?: Record<string, unknown>;
    };
    expect(plain.summaries).toBeUndefined();

    const withSummary = (await (
      await client.get("/api/projects/summary_owner-p/activities?summary=1")
    ).json()) as { summaries: Record<string, { canonical: boolean }> };
    expect(withSummary.summaries[firstId]).toEqual({
      canonical: true,
      hasPlan: false,
      done: 0,
      total: 3,
      status: { kind: "next", milestone: "spec" },
    });
    // The product's first ref is canonical; the second is not.
    expect(withSummary.summaries[secondId]!.canonical).toBe(false);
  });

  it("calls a ref with no product row (it predates the product level) canonical", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "legacy_owner");
    const client = apiClient(t.app, owner.cookie);
    await client.post("/api/projects", { projectId: "legacy_owner-p", name: "P" });
    await client.post("/api/projects/legacy_owner-p/activities", {
      productCode: "ants",
      refNum: 1,
      title: "Counting ants",
    });
    const second = await client.post("/api/projects/legacy_owner-p/activities", {
      productCode: "ants",
      refNum: 2,
      title: "Ants at night",
    });
    const secondId = ((await second.json()) as { id: string }).id;
    // Ref 2 is not canonical while it belongs to the product; written the way a
    // pre-product-level build left it (no product), it is the only ref it could build on.
    t.deps.db.prepare("UPDATE activities SET product_id = NULL WHERE id = ?").run(secondId);

    const response = await client.get("/api/projects/legacy_owner-p/activities?summary=1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      activities: { id: string }[];
      summaries: Record<string, { canonical: boolean }>;
    };
    expect(body.activities.map((activity) => activity.id)).toContain(secondId);
    expect(body.summaries[secondId]!.canonical).toBe(true);
  });
});
