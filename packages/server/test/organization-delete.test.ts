/**
 * Deleting an organization releases what plugins and sessions hold of it before its directory
 * moves (runtime/organization/retire.ts): the organization is marked as being deleted (gone for
 * every reader but the delete), each plugin retirement is awaited in turn — one that throws or
 * outlives its 30 s is recorded and the delete goes on — the organization's sessions are
 * stopped, then the directory moves to the trash. A move that fails lifts the mark and answers
 * 409 `organization_busy`, never 500.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrgRetirement } from "../src/runtime/organization/deps.js";
import { RETIREMENT_TIMEOUT_MS } from "../src/runtime/organization/retire.js";
import { makeOrgHarness } from "./org-harness.js";
import type { OrgHarness } from "./org-harness.js";

const P = "p1";
const ORG = "acme";
const OTHER = "globex";
const T0 = Date.parse("2026-09-01T01:00:00Z");

async function createOrg(h: OrgHarness, orgId: string): Promise<void> {
  await h.service.create(P, { orgId, name: orgId, mission: "Build it" }, "alice");
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

describe("deleting an organization", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks it deleted, awaits each retirement, stops its sessions, then moves it to the trash", async () => {
    const steps: string[] = [];
    let h!: OrgHarness;
    const dirExists = () => exists(h.store.dir(P, ORG));
    const retirement = (id: string): OrgRetirement => ({
      id,
      retire: async (org) => {
        // Gone for every reader while the delete runs; the directory is still in place.
        steps.push(
          `${id}:${org.orgId}:view=${String(await h.service.gatewayView(P, ORG))}:dir=${String(await dirExists())}`,
        );
        await new Promise((r) => setTimeout(r, 5));
        steps.push(`${id}:done`);
      },
    });
    h = await makeOrgHarness({
      nowMs: T0,
      retirements: [retirement("first"), retirement("second")],
      stopSession: (sessionId) => {
        steps.push(`stop:${sessionId}`);
      },
    });
    await createOrg(h, ORG);
    await createOrg(h, OTHER);
    const desk = await h.service.desk(P, ORG, `${ORG}_ceo`, {});
    // A room a plugin opened through the gateway: the cache does not list it, the session row does.
    const room = await h.service.gatewayOpenSession({
      projectId: P,
      orgId: ORG,
      agentId: `${ORG}_ceo`,
      title: "Room",
      body: "Discuss",
    });
    const elsewhere = await h.service.desk(P, OTHER, `${OTHER}_ceo`, {});

    await h.service.delete(P, ORG);

    expect(steps.slice(0, 4)).toEqual([
      `first:${ORG}:view=null:dir=true`,
      "first:done",
      `second:${ORG}:view=null:dir=true`,
      "second:done",
    ]);
    const stopped = steps.slice(4);
    expect(new Set(stopped)).toEqual(new Set([`stop:${desk.sessionId}`, `stop:${room.sessionId}`]));
    expect(stopped).not.toContain(`stop:${elsewhere.sessionId}`);
    expect(await dirExists()).toBe(false);
    const bin = path.join(path.dirname(h.store.dir(P, ORG)), ".trash");
    expect(await fs.readdir(bin)).toHaveLength(1);
    expect(h.errors).toEqual([]);
    // The other organization is untouched, and the id is free again once its CEO goes.
    expect(await h.service.gatewayView(P, OTHER)).not.toBeNull();
  });

  it("records a retirement that throws or outlives 30 s, and deletes anyway", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const hangingStarted = deferred();
    const calls: string[] = [];
    const h = await makeOrgHarness({
      nowMs: T0,
      retirements: [
        {
          id: "throws",
          retire: async () => {
            calls.push("throws");
            throw new Error("connection would not close");
          },
        },
        {
          id: "hangs",
          retire: () => {
            calls.push("hangs");
            hangingStarted.resolve();
            return new Promise<void>(() => undefined);
          },
        },
        {
          id: "after",
          retire: async () => {
            calls.push("after");
          },
        },
      ],
    });
    await createOrg(h, ORG);

    const deleting = h.service.delete(P, ORG);
    await hangingStarted.promise;
    await vi.advanceTimersByTimeAsync(RETIREMENT_TIMEOUT_MS);
    await deleting;

    expect(calls).toEqual(["throws", "hangs", "after"]);
    expect(h.errors.map((e) => e.code)).toEqual([
      "org_retirement_failed",
      "org_retirement_timeout",
    ]);
    expect(String(h.errors[1]!.err)).toContain("hangs did not finish within 30 s");
    expect(await exists(h.store.dir(P, ORG))).toBe(false);
  });

  it("answers 409 organization_busy when the move fails, and lifts the mark", async () => {
    const h = await makeOrgHarness({ nowMs: T0 });
    await createOrg(h, ORG);
    // The trash cannot be made: a file stands where its directory goes.
    const bin = path.join(path.dirname(h.store.dir(P, ORG)), ".trash");
    await fs.writeFile(bin, "in the way");

    const err = await h.service.delete(P, ORG).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, code: "organization_busy" });
    expect((err as Error).message).toContain(h.store.dir(P, ORG));
    expect((err as Error).message).toMatch(/EEXIST|ENOTDIR/);

    // Not marked any more: the organization reads and writes as before, and a later delete works.
    expect(await h.service.gatewayView(P, ORG)).not.toBeNull();
    await h.service.detail(P, ORG, "alice");
    await fs.rm(bin);
    await h.service.delete(P, ORG);
    expect(await exists(h.store.dir(P, ORG))).toBe(false);
  });

  it("answers 404 to new reads and writes while the delete runs; other organizations answer as usual", async () => {
    const release = deferred();
    const entered = deferred();
    const h = await makeOrgHarness({
      nowMs: T0,
      retirements: [
        {
          id: "slow",
          retire: async () => {
            entered.resolve();
            await release.promise;
          },
        },
      ],
    });
    await createOrg(h, ORG);
    await createOrg(h, OTHER);

    const deleting = h.service.delete(P, ORG);
    await entered.promise;
    await expect(h.service.detail(P, ORG, "alice")).rejects.toMatchObject({ status: 404 });
    expect(await h.service.gatewayView(P, ORG)).toBeNull();
    const write = h.service
      .patch(P, ORG, { mission: "Changed under the delete" }, "alice")
      .catch((e: unknown) => e);
    // Another organization is not held by this one's delete.
    expect(await h.service.gatewayView(P, OTHER)).not.toBeNull();
    await h.service.patch(P, OTHER, { mission: "Still mine" }, "alice");

    release.resolve();
    await deleting;
    expect(await write).toMatchObject({ status: 404 });
    expect(await exists(h.store.dir(P, ORG))).toBe(false);
  });
});
