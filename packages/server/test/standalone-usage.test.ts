/**
 * A request beside a Session's own (a plugin's tool request, recorded "standalone") while the
 * Session's own request is in flight.
 *
 * - Given a standalone request that fails while the Session's request runs, the failure is one row
 *   of its own, with its purpose, and the Session's request is still counted once — not again as a
 *   failure when it ends after reporting usage.
 */
import { expect, it } from "vitest";
import { emptyTokenCounts, requestBegin, requestEnd, tokenUsage } from "@prismshadow/penguin-core";
import { wire } from "@prismshadow/penguin-core/kernel";
import { openDatabase } from "@prismshadow/penguin-library-db";
import { UsageRepo } from "@prismshadow/penguin-library-observability/repos/usage";
import { UsageRecorder } from "../src/runtime/usage-recorder.js";

it("keeps a standalone failure apart from the Session's metered request", async () => {
  const db = openDatabase(":memory:");
  try {
    const ctx = { projectId: "p", agentId: "a", sessionId: "s", provider: "custom", modelId: "m" };
    const usage = wire(UsageRepo, { db });
    const projects = { findById: (projectId: string) => ({ projectId }) };
    const recorder = wire(UsageRecorder, { usage, projects, clock: { now: () => new Date() } });
    const spent = { cache_read: 0, cache_write: 4, output: 2, total: 6 };

    await recorder.record(ctx, requestBegin());
    await recorder.record(
      { ...ctx, modelId: "tool", purpose: "@acme/tools:t2i" },
      requestEnd("fatal"),
      "standalone",
    );
    await recorder.record(ctx, tokenUsage(emptyTokenCounts(), spent));
    await recorder.record(ctx, requestEnd("retryable", { errorCode: "network" }));

    expect(
      db.prepare("SELECT model_id, purpose, status, total FROM usage_records ORDER BY id").all(),
    ).toEqual([
      { model_id: "tool", purpose: "@acme/tools:t2i", status: "fatal", total: 0 },
      { model_id: "m", purpose: null, status: "completed", total: 6 },
    ]);
  } finally {
    db.close();
  }
});
