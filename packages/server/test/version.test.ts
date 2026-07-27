/**
 * Version routes and update-check service tests: response shapes, the fail-soft
 * contract of /api/version/update-check (always 200, error field instead of 5xx),
 * the running release's own publish-date resolution (`currentPublishedAt`, only for
 * builds with no stamped date), cache TTLs with an injected clock, the
 * PENGUIN_UPDATE_CHECK=off opt-out, and the admin gate of POST /api/version/update.
 * Nothing here touches the network or spawns a process: fetch is stubbed, and the
 * update run is exercised only through its pure classifier and the "not launched via
 * the CLI" early exit.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERSION } from "@prismshadow/penguin-core";
import type { UpdateCheckResponse, UpdateRunResponse, VersionResponse } from "../src/api/types.js";
import {
  FAILURE_TTL_MS,
  LATEST_RELEASE_API,
  SUCCESS_TTL_MS,
  UpdateCheckService,
  releaseTagApi,
} from "../src/services/update-check-service.js";
import { classifyUpdateRun } from "../src/http/routes/version.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** Counting fetch stub; the handler decides the outcome per call (and may branch on the URL). */
function makeFetch(handler: (url: string) => Response | Promise<Response>): {
  impl: typeof fetch;
  state: { calls: number; urls: string[] };
} {
  const state = { calls: 0, urls: [] as string[] };
  const impl: typeof fetch = async (input) => {
    state.calls += 1;
    state.urls.push(String(input));
    return handler(String(input));
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

  it("requires auth and reports core's version identity (dev build: buildDate null)", async () => {
    expect((await t.app.request("/api/version")).status).toBe(401);

    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/version");
    expect(res.status).toBe(200);
    const body = (await res.json()) as VersionResponse;
    expect(body).toEqual({ version: VERSION, buildDate: null });
  });
});

describe("GET /api/version/update-check", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.cleanup();
  });

  it("reports a newer release with its URL and publish date (and the running release's own date)", async () => {
    // The test build has no stamped BUILD_DATE, so the service also resolves the
    // running version's release date from the tag endpoint.
    const { impl } = makeFetch((url) =>
      url === LATEST_RELEASE_API
        ? releaseResponse("v99.0.0")
        : new Response(
            JSON.stringify({ tag_name: `v${VERSION}`, published_at: "2026-05-05T12:00:00Z" }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
    );
    t = await createTestApp({ updateCheck: new UpdateCheckService({ fetchImpl: impl, env: {} }) });
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
    expect(body.currentPublishedAt).toBe("2026-05-05T12:00:00Z");
    expect(body.error).toBeUndefined();
    expect(body.disabled).toBeUndefined();
  });

  it("fail-soft: an unreachable endpoint is HTTP 200 with error=network, not a 5xx", async () => {
    const { impl } = makeFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    });
    t = await createTestApp({ updateCheck: new UpdateCheckService({ fetchImpl: impl, env: {} }) });
    const admin = await loginAdmin(t.app);
    const res = await apiClient(t.app, admin.cookie).get("/api/version/update-check");
    expect(res.status).toBe(200);
    const body = (await res.json()) as UpdateCheckResponse;
    expect(body.error).toBe("network");
    expect(body.latestVersion).toBeNull();
    expect(body.updateAvailable).toBe(false);
    expect(body.releaseUrl).toBeNull();
    expect(body.currentPublishedAt).toBeNull();
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
      const service = new UpdateCheckService({ fetchImpl: makeFetch(make).impl, env: {} });
      const result = await service.check();
      expect(result.error).toBe(expected);
      expect(result.updateAvailable).toBe(false);
      expect(result.latestVersion).toBeNull();
    }
  });

  it("updateAvailable is false when the latest release is not newer", async () => {
    const { impl } = makeFetch(() => releaseResponse(`v${VERSION}`));
    const service = new UpdateCheckService({ fetchImpl: impl, env: {} });
    const result = await service.check();
    expect(result.error).toBeUndefined();
    expect(result.latestVersion).toBe(VERSION);
    expect(result.updateAvailable).toBe(false);
  });

  it("PENGUIN_UPDATE_CHECK=off disables the lookup without any network call", async () => {
    const { impl, state } = makeFetch(() => releaseResponse("v99.0.0"));
    const service = new UpdateCheckService({
      fetchImpl: impl,
      env: { PENGUIN_UPDATE_CHECK: "off" },
    });
    const result = await service.check();
    expect(result.disabled).toBe(true);
    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBeNull();
    expect(result.currentPublishedAt).toBeNull();
    expect(state.calls).toBe(0);
  });

  it("resolves the running version's release date from the tag endpoint when no build date is stamped", async () => {
    const { impl, state } = makeFetch((url) =>
      url === LATEST_RELEASE_API
        ? releaseResponse("v99.0.0")
        : new Response(
            JSON.stringify({ tag_name: `v${VERSION}`, published_at: "2026-05-05T12:00:00Z" }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
    );
    const service = new UpdateCheckService({ fetchImpl: impl, env: {}, buildDate: null });
    const result = await service.check();
    expect(state.urls).toContain(releaseTagApi(VERSION));
    expect(result.currentPublishedAt).toBe("2026-05-05T12:00:00Z");
    expect(result.latestVersion).toBe("99.0.0");
  });

  it("skips the current-release lookup entirely when a build date is stamped", async () => {
    const { impl, state } = makeFetch(() => releaseResponse("v99.0.0"));
    const service = new UpdateCheckService({ fetchImpl: impl, env: {}, buildDate: "2026-06-01" });
    const result = await service.check();
    expect(state.urls).toEqual([LATEST_RELEASE_API]);
    expect(result.buildDate).toBe("2026-06-01");
    expect(result.currentPublishedAt).toBeNull();
    expect(result.latestVersion).toBe("99.0.0");
  });

  it("fail-soft: a failed current-release lookup leaves the field null without erroring the check", async () => {
    // A dev version has no release tag: the tag endpoint 404s while the latest lookup works.
    const { impl } = makeFetch((url) =>
      url === LATEST_RELEASE_API
        ? releaseResponse("v99.0.0")
        : new Response("not found", { status: 404 }),
    );
    const service = new UpdateCheckService({ fetchImpl: impl, env: {}, buildDate: null });
    const result = await service.check();
    expect(result.error).toBeUndefined();
    expect(result.latestVersion).toBe("99.0.0");
    expect(result.currentPublishedAt).toBeNull();
  });

  it("caches a success for an hour and a failure for ten minutes", async () => {
    let nowMs = 1_000_000_000;
    let fail = false;
    const { impl, state } = makeFetch(() => {
      if (fail) throw new Error("down");
      return releaseResponse("v99.0.0");
    });
    const service = new UpdateCheckService({
      fetchImpl: impl,
      env: {},
      now: () => new Date(nowMs),
      // Stamped build date: the current-release lookup is skipped, so every cache miss
      // is exactly one request and the call counts below stay unambiguous.
      buildDate: "2026-06-01",
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
    const body = (await res.json()) as UpdateRunResponse;
    expect(body).toEqual({
      status: "unsupported",
      reason: "not_launched_via_cli",
      output: "",
      needsRestart: false,
    });
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
