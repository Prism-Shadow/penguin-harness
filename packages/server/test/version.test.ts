/**
 * The version routes and the update check behind the About page.
 *
 * - GET /api/version needs a session and serves exactly the report `penguin version --json`
 *   prints; a root with nothing pushed reports no harness, and a pushed one reports its store.
 * - The update check reports a newer release with its URL and date; an unreachable endpoint
 *   is still a 200, carrying `error: network` instead of a 5xx.
 * - A plain check is answered from the cache; `?force=1` (the manual check) bypasses it and
 *   the fresh outcome is what later plain checks see.
 * - A rate-limit answer reads as rate_limited, any other bad status or body as bad_response;
 *   a latest release that is not newer is no update.
 * - PENGUIN_UPDATE_CHECK=off answers disabled and never dials out, forced or not.
 * - A success is cached for an hour and a failure for ten minutes.
 * - The update job is admin-only; before any run it is idle, and a server not launched through
 *   the CLI finishes it at once as unsupported, readable afterwards.
 * - A restart is admin-only and refused when nothing supervises the process.
 *
 * Nothing here touches the network or spawns a process: the release lookup is the fetch fake.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { VERSION } from "@prismshadow/penguin-core";
import { versionReport } from "../src/version-report.js";
import type {
  RestartResponse,
  UpdateCheckResponse,
  UpdateJobStatus,
  UpdateRunResponse,
  VersionResponse,
} from "../src/api/types.js";
import {
  FAILURE_TTL_MS,
  SUCCESS_TTL_MS,
  UpdateCheckService,
} from "../src/services/update-check-service.js";
import { fakeFetch } from "./fixtures/fetch.js";
import type { FetchScript } from "./fixtures/fetch.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { wire } from "@prismshadow/penguin-core/kernel";

function releaseResponse(tag: string): Response {
  return new Response(
    JSON.stringify({
      tag_name: tag,
      html_url: `https://github.com/Prism-Shadow/penguin-harness/releases/tag/${tag}`,
      published_at: "2026-07-01T00:00:00Z",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** An update-check service over the fetch fake; `calls` counts the lookups that reached it. */
function updateCheck(
  script: FetchScript,
  env: Record<string, string> = {},
  now: () => Date = () => new Date(),
) {
  const releases = fakeFetch(script);
  const service = wire(UpdateCheckService, {
    http: { fetch: releases.fetch },
    env,
    clock: { now },
  });
  return { service, calls: () => releases.calls.length };
}

describe("GET /api/version", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("requires auth and serves the version report unchanged", async () => {
    expect((await t.app.request("/api/version")).status).toBe(401);

    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/version");
    expect(res.status).toBe(200);
    const body = (await res.json()) as VersionResponse;
    // Compared against the producer, never against literals. The release workflow STAMPS
    // core's constants before it builds and tests, so a hardcoded null passes everywhere
    // except the one job that matters — the npm publish — where it failed the release.
    // This is also the contract that `penguin version --json` prints the same record: the
    // route adds no field of its own and drops none.
    expect(body).toEqual(await versionReport(t.root));
    // Non-vacuous floor, in case the report itself ever comes back degenerate.
    expect(body.version).toBe(VERSION);
    // `v` and a digit is the whole guarantee: a tag description names the nearest reachable
    // tag, which is the PREVIOUS version throughout release preparation (VERSION is bumped
    // in its own commit, the tag follows), so pinning `v${VERSION}` would fail on exactly
    // the branch that cuts a release.
    expect(body.describe).toMatch(/^v\d/);
    expect(["release", "source"]).toContain(body.channel);
  });

  it("reports no harness for a root with nothing pushed, and the store's once there is", async () => {
    const admin = await loginAdmin(t.app);
    const get = async () =>
      (await (await apiClient(t.app, admin.cookie).get("/api/version")).json()) as VersionResponse;

    // A fresh test root has an empty HMR store: the build is packaged, not hot-updated.
    expect((await get()).harness).toBeNull();

    const hmrDir = path.join(t.root, "hmr");
    await fs.mkdir(hmrDir, { recursive: true });
    await fs.writeFile(
      path.join(hmrDir, "harness.json"),
      JSON.stringify({
        cli: { bundle: "store/cli/abc123.mjs" },
        source: { repo: "https://example.com/penguin.git", revision: "v0.2.3-7-gabc1234" },
        pushedAt: "2026-08-20T10:15:00.000Z",
      }),
    );

    expect((await get()).harness).toEqual({
      source: { repo: "https://example.com/penguin.git", revision: "v0.2.3-7-gabc1234" },
      pushedAt: "2026-08-20T10:15:00.000Z",
      bundles: { platform: null, cli: "store/cli/abc123.mjs", web: null },
      assets: null,
    });
  });
});

describe("GET /api/version/update-check", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.cleanup();
  });

  it("reports a newer release with its URL and publish date", async () => {
    t = await createTestApp({ updateCheck: updateCheck(() => releaseResponse("v99.0.0")).service });
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/version/update-check");
    expect(res.status).toBe(200);
    const body = (await res.json()) as UpdateCheckResponse;
    expect(body.currentVersion).toBe(VERSION);
    expect(body.latestVersion).toBe("99.0.0");
    expect(body.updateAvailable).toBe(true);
    expect(body.releaseUrl).toBe(
      "https://github.com/Prism-Shadow/penguin-harness/releases/tag/v99.0.0",
    );
    expect(body.publishedAt).toBe("2026-07-01T00:00:00Z");
    expect(body.error).toBeUndefined();
    expect(body.disabled).toBeUndefined();
  });

  it("answers an unreachable endpoint with a 200 carrying error=network, not a 5xx", async () => {
    const { service } = updateCheck(() => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    });
    t = await createTestApp({ updateCheck: service });
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/version/update-check");
    expect(res.status).toBe(200);
    const body = (await res.json()) as UpdateCheckResponse;
    expect(body.error).toBe("network");
    expect(body.latestVersion).toBeNull();
    expect(body.updateAvailable).toBe(false);
    expect(body.releaseUrl).toBeNull();
  });

  it("answers a plain check from the cache, and ?force=1 refetches and recaches", async () => {
    let tag = "v99.0.0";
    const check = updateCheck(() => releaseResponse(tag));
    t = await createTestApp({ updateCheck: check.service });
    const admin = await loginAdmin(t.app);
    const client = apiClient(t.app, admin.cookie);
    const latest = async (url: string) =>
      ((await (await client.get(url)).json()) as UpdateCheckResponse).latestVersion;

    // Warm the cache, then confirm a plain GET serves from it.
    expect(await latest("/api/version/update-check")).toBe("99.0.0");
    expect(await latest("/api/version/update-check")).toBe("99.0.0");
    expect(check.calls()).toBe(1);

    // The manual check refetches despite the fresh cache…
    tag = "v100.0.0";
    expect(await latest("/api/version/update-check?force=1")).toBe("100.0.0");
    expect(check.calls()).toBe(2);
    // …and stores what it found: the next plain check reuses it without a call.
    expect(await latest("/api/version/update-check")).toBe("100.0.0");
    expect(check.calls()).toBe(2);
  });
});

describe("UpdateCheckService", () => {
  it("reads 403/429 as rate_limited and any other bad status or body as bad_response", async () => {
    for (const [make, expected] of [
      [() => new Response("limited", { status: 403 }), "rate_limited"],
      [() => new Response("limited", { status: 429 }), "rate_limited"],
      [() => new Response("oops", { status: 500 }), "bad_response"],
      [() => new Response("not json", { status: 200 }), "bad_response"],
      [() => new Response(JSON.stringify({ name: "no tag" }), { status: 200 }), "bad_response"],
    ] as const) {
      const result = await updateCheck(make).service.check();
      expect(result.error).toBe(expected);
      expect(result.updateAvailable).toBe(false);
      expect(result.latestVersion).toBeNull();
    }
  });

  it("reports no update when the latest release is not newer", async () => {
    const result = await updateCheck(() => releaseResponse(`v${VERSION}`)).service.check();
    expect(result.error).toBeUndefined();
    expect(result.latestVersion).toBe(VERSION);
    expect(result.updateAvailable).toBe(false);
  });

  it("never dials out under PENGUIN_UPDATE_CHECK=off, forced or not", async () => {
    const check = updateCheck(() => releaseResponse("v99.0.0"), { PENGUIN_UPDATE_CHECK: "off" });
    for (const force of [false, true]) {
      const result = await check.service.check(force);
      expect(result.disabled).toBe(true);
      expect(result.updateAvailable).toBe(false);
      expect(result.latestVersion).toBeNull();
    }
    expect(check.calls()).toBe(0);
  });

  it("caches a success for an hour and a failure for ten minutes", async () => {
    let nowMs = 1_000_000_000;
    let fail = false;
    const check = updateCheck(
      () => {
        if (fail) throw new Error("down");
        return releaseResponse("v99.0.0");
      },
      {},
      () => new Date(nowMs),
    );
    const service = check.service;

    const first = await service.check();
    expect(first.latestVersion).toBe("99.0.0");
    expect(check.calls()).toBe(1);

    // Within the success TTL: served from cache, original checkedAt preserved.
    nowMs += SUCCESS_TTL_MS - 1;
    const cached = await service.check();
    expect(check.calls()).toBe(1);
    expect(cached.checkedAt).toBe(first.checkedAt);

    // Past the success TTL: refetched; the failure is itself cached, but only briefly.
    nowMs += 2;
    fail = true;
    const failed = await service.check();
    expect(check.calls()).toBe(2);
    expect(failed.error).toBe("network");

    nowMs += FAILURE_TTL_MS - 1;
    expect((await service.check()).error).toBe("network");
    expect(check.calls()).toBe(2);

    nowMs += 2;
    fail = false;
    const healed = await service.check();
    expect(check.calls()).toBe(3);
    expect(healed.error).toBeUndefined();
    expect(healed.latestVersion).toBe("99.0.0");
  });
});

describe("POST /api/version/update", () => {
  let t: TestApp;
  let savedEntry: string | undefined;
  beforeEach(async () => {
    savedEntry = process.env.PENGUIN_CLI_ENTRY;
    delete process.env.PENGUIN_CLI_ENTRY;
    t = await createTestApp();
  });
  afterEach(async () => {
    if (savedEntry === undefined) delete process.env.PENGUIN_CLI_ENTRY;
    else process.env.PENGUIN_CLI_ENTRY = savedEntry;
    await t.cleanup();
  });

  it("is admin-only both ways, and idle before any run", async () => {
    const user = apiClient(t.app, (await provisionUser(t.app, "regular_user")).cookie);
    expect((await user.post("/api/version/update", {})).status).toBe(403);
    expect((await user.get("/api/version/update")).status).toBe(403);
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/version/update");
    expect(res.status).toBe(200);
    expect((await res.json()) as UpdateJobStatus).toEqual({
      state: "idle",
      targetVersion: null,
      output: "",
    });
  });

  it("reports unsupported when the server was not launched via the CLI", async () => {
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).post("/api/version/update", {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as UpdateJobStatus;
    expect(body.state).toBe("done");
    expect(body.result).toEqual({
      status: "unsupported",
      reason: "not_launched_via_cli",
      output: "",
      needsRestart: false,
    } satisfies UpdateRunResponse);
    // The finished status stays readable at GET until the next start.
    const again = await apiClient(t.app, admin.cookie).get("/api/version/update");
    expect(((await again.json()) as UpdateJobStatus).result?.status).toBe("unsupported");
  });
});

describe("POST /api/version/restart", () => {
  it("is admin-only, and refuses when nothing supervises the process", async () => {
    // Tests boot unsupervised (PENGUIN_SUPERVISED unset): exiting would stop a service nobody
    // brings back, so the route says so instead of leaving.
    const t = await createTestApp();
    try {
      const user = await provisionUser(t.app, "regular_user");
      expect((await apiClient(t.app, user.cookie).post("/api/version/restart", {})).status).toBe(
        403,
      );
      const admin = await loginAdmin(t.app);
      const res = await apiClient(t.app, admin.cookie).post("/api/version/restart", {});
      expect(res.status).toBe(200);
      expect((await res.json()) as RestartResponse).toEqual({
        restarting: false,
        reason: "no_supervisor",
      });
    } finally {
      await t.cleanup();
    }
  });
});
