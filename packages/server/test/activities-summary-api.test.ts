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
});
