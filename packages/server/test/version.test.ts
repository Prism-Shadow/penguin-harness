/**
 * Version routes and update-check service tests: response shapes, the fail-soft
 * contract of /api/version/update-check (always 200, error field instead of 5xx),
 * cache TTLs with an injected clock, the PENGUIN_UPDATE_CHECK=off opt-out, and the
 * admin gate of POST /api/version/update. Nothing here touches the network or spawns
 * a process: fetch is stubbed, and the update run is exercised only through its pure
 * classifier and the "not launched via the CLI" early exit.
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
import { classifyUpdateRun } from "../src/http/routes/version.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { wire } from "@prismshadow/penguin-core/kernel";

/** Counting fetch stub; the handler decides the outcome per call. */
function makeFetch(handler: () => Response | Promise<Response>): {
  impl: typeof fetch;
  state: { calls: number };
} {
  const state = { calls: 0 };
  const impl: typeof fetch = async () => {
    state.calls += 1;
    return handler();
  };
  return { impl, state };
}

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
      ifaces: null,
    });
  });
});

describe("GET /api/version/update-check", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.cleanup();
  });

  it("reports a newer release with its URL and publish date", async () => {
    const { impl } = makeFetch(() => releaseResponse("v99.0.0"));
    t = await createTestApp({
      updateCheck: wire(UpdateCheckService, {
        http: { fetch: impl },
        env: {},
        clock: { now: () => new Date() },
      }),
    });
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

  it("fail-soft: an unreachable endpoint is HTTP 200 with error=network, not a 5xx", async () => {
    const { impl } = makeFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    });
    t = await createTestApp({
      updateCheck: wire(UpdateCheckService, {
        http: { fetch: impl },
        env: {},
        clock: { now: () => new Date() },
      }),
    });
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/version/update-check");
    expect(res.status).toBe(200);
    const body = (await res.json()) as UpdateCheckResponse;
    expect(body.error).toBe("network");
    expect(body.latestVersion).toBeNull();
    expect(body.updateAvailable).toBe(false);
    expect(body.releaseUrl).toBeNull();
  });

  it("?force=1 (the manual check) reaches the service as a cache bypass", async () => {
    const { impl, state } = makeFetch(() => releaseResponse("v99.0.0"));
    t = await createTestApp({
      updateCheck: wire(UpdateCheckService, {
        http: { fetch: impl },
        env: {},
        clock: { now: () => new Date() },
      }),
    });
    const admin = await loginAdmin(t.app);
    const client = apiClient(t.app, admin.cookie);

    // Warm the cache, then confirm a plain GET serves from it.
    expect((await client.get("/api/version/update-check")).status).toBe(200);
    expect((await client.get("/api/version/update-check")).status).toBe(200);
    expect(state.calls).toBe(1);

    const forced = await client.get("/api/version/update-check?force=1");
    expect(forced.status).toBe(200);
    expect(((await forced.json()) as UpdateCheckResponse).latestVersion).toBe("99.0.0");
    expect(state.calls).toBe(2);
  });
});

describe("UpdateCheckService", () => {
  it("maps 403/429 to rate_limited and other bad statuses/bodies to bad_response", async () => {
    for (const [make, expected] of [
      [() => new Response("limited", { status: 403 }), "rate_limited"],
      [() => new Response("limited", { status: 429 }), "rate_limited"],
      [() => new Response("oops", { status: 500 }), "bad_response"],
      [() => new Response("not json", { status: 200 }), "bad_response"],
      [() => new Response(JSON.stringify({ name: "no tag" }), { status: 200 }), "bad_response"],
    ] as const) {
      const service = wire(UpdateCheckService, {
        http: { fetch: makeFetch(make).impl },
        env: {},
        clock: { now: () => new Date() },
      });
      const result = await service.check();
      expect(result.error).toBe(expected);
      expect(result.updateAvailable).toBe(false);
      expect(result.latestVersion).toBeNull();
    }
  });

  it("updateAvailable is false when the latest release is not newer", async () => {
    const { impl } = makeFetch(() => releaseResponse(`v${VERSION}`));
    const service = wire(UpdateCheckService, {
      http: { fetch: impl },
      env: {},
      clock: { now: () => new Date() },
    });
    const result = await service.check();
    expect(result.error).toBeUndefined();
    expect(result.latestVersion).toBe(VERSION);
    expect(result.updateAvailable).toBe(false);
  });

  it("PENGUIN_UPDATE_CHECK=off disables the lookup without any network call", async () => {
    const { impl, state } = makeFetch(() => releaseResponse("v99.0.0"));
    const service = wire(UpdateCheckService, {
      http: { fetch: impl },
      env: { PENGUIN_UPDATE_CHECK: "off" },
      clock: { now: () => new Date() },
    });
    const result = await service.check();
    expect(result.disabled).toBe(true);
    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBeNull();
    expect(state.calls).toBe(0);
  });

  it("caches a success for an hour and a failure for ten minutes", async () => {
    let nowMs = 1_000_000_000;
    let fail = false;
    const { impl, state } = makeFetch(() => {
      if (fail) throw new Error("down");
      return releaseResponse("v99.0.0");
    });
    const service = wire(UpdateCheckService, {
      http: { fetch: impl },
      env: {},
      clock: { now: () => new Date(nowMs) },
    });

    const first = await service.check();
    expect(first.latestVersion).toBe("99.0.0");
    expect(state.calls).toBe(1);

    // Within the success TTL: served from cache, original checkedAt preserved.
    nowMs += SUCCESS_TTL_MS - 1;
    const cached = await service.check();
    expect(state.calls).toBe(1);
    expect(cached.checkedAt).toBe(first.checkedAt);

    // Past the success TTL: refetched; the failure is itself cached, but only briefly.
    nowMs += 2;
    fail = true;
    const failed = await service.check();
    expect(state.calls).toBe(2);
    expect(failed.error).toBe("network");

    nowMs += FAILURE_TTL_MS - 1;
    expect((await service.check()).error).toBe("network");
    expect(state.calls).toBe(2);

    nowMs += 2;
    fail = false;
    const healed = await service.check();
    expect(state.calls).toBe(3);
    expect(healed.error).toBeUndefined();
    expect(healed.latestVersion).toBe("99.0.0");
  });

  it("force bypasses a warm cache and recaches the fresh outcome", async () => {
    let tag = "v99.0.0";
    const { impl, state } = makeFetch(() => releaseResponse(tag));
    const service = wire(UpdateCheckService, {
      http: { fetch: impl },
      env: {},
      clock: { now: () => new Date() },
    });

    // Warm the cache; a passive check is then served from it.
    expect((await service.check()).latestVersion).toBe("99.0.0");
    expect((await service.check()).latestVersion).toBe("99.0.0");
    expect(state.calls).toBe(1);

    // A forced check refetches despite the fresh cache…
    tag = "v100.0.0";
    expect((await service.check(true)).latestVersion).toBe("100.0.0");
    expect(state.calls).toBe(2);

    // …and stores the outcome: the next passive check reuses it without a call.
    expect((await service.check()).latestVersion).toBe("100.0.0");
    expect(state.calls).toBe(2);
  });

  it("force never dials out when PENGUIN_UPDATE_CHECK=off (the opt-out stays authoritative)", async () => {
    const { impl, state } = makeFetch(() => releaseResponse("v99.0.0"));
    const service = wire(UpdateCheckService, {
      http: { fetch: impl },
      env: { PENGUIN_UPDATE_CHECK: "off" },
      clock: { now: () => new Date() },
    });
    const result = await service.check(true);
    expect(result.disabled).toBe(true);
    expect(state.calls).toBe(0);
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

  it("is admin-only", async () => {
    const user = await provisionUser(t.app, "regular_user");
    const res = await apiClient(t.app, user.cookie).post("/api/version/update", {});
    expect(res.status).toBe(403);
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

  it("GET /api/version/update is admin-only and idle before any run", async () => {
    const user = await provisionUser(t.app, "regular_user");
    expect((await apiClient(t.app, user.cookie).get("/api/version/update")).status).toBe(403);
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/version/update");
    expect(res.status).toBe(200);
    expect((await res.json()) as UpdateJobStatus).toEqual({
      state: "idle",
      targetVersion: null,
      output: "",
    });
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

describe("classifyUpdateRun", () => {
  it("a non-zero exit is a failed upgrade attempt", () => {
    const r = classifyUpdateRun(1, "Upgrade failed; the previous install was left in place.");
    expect(r.status).toBe("failed");
    expect(r.needsRestart).toBe(false);
  });

  it("a refusal (exit 0 with the CLI's refusal message) is unsupported", () => {
    // Literal CLI copy (packages/cli/src/i18n.ts update.sourceCheckout / unknownInstall):
    // the classifier matches fragments of these exact strings.
    const source =
      "This penguin runs from a source checkout, so there is nothing to download — update it with `git pull` and rebuild (`pnpm install && pnpm -r build`).";
    expect(classifyUpdateRun(0, source).status).toBe("unsupported");
    const unknown =
      "Cannot tell how this penguin was installed (running from /opt/penguin/cli.js), so it will not be replaced. Re-install with the official installer, or upgrade with the package manager you used.";
    expect(classifyUpdateRun(0, unknown).status).toBe("unsupported");
  });

  it("a clean exit without a refusal is updated and needs a restart (up-to-date included)", () => {
    const done =
      "Upgrade 0.1.2 -> 0.1.3\nPenguinHarness 0.1.3 installed. Run `penguin --version` in a new shell to confirm.";
    expect(classifyUpdateRun(0, done)).toEqual({
      status: "updated",
      output: done,
      needsRestart: true,
    });
    const upToDate = "Already on the latest version (0.1.3); nothing to do.";
    expect(classifyUpdateRun(0, upToDate).status).toBe("updated");
  });
});
