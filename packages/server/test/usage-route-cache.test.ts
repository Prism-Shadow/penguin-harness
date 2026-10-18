/**
 * The dashboard read's response cache (http/routes/usage.ts, `usageCacheKey`): what one entry
 * covers, what it never covers, and what is never stored.
 *
 * - A repeat inside the TTL is served from the entry rather than queried again; past the TTL
 *   the service is asked again.
 * - The dashboard recomputes its rolling `fromTs`/`toTs` on every poll, so the two instants are
 *   folded to 30s buckets in the KEY: polls describing one bucket share an entry, and two
 *   buckets are two entries.
 * - The key carries the whole request shape — the Project and the admin flag included — so a
 *   member's read is never answered with an admin's unattributed rows.
 * - Concurrent identical reads await the query already running instead of starting a second.
 * - A failed query is not cached: its slot is cleared and the next read asks again.
 *
 * The route is mounted alone with the service it takes, so the assertions count queries rather
 * than time the endpoint; each mount gets its own cache, as each app instance does.
 */
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { UsageResponse } from "../src/api/types.js";
import type { AppEnv } from "../src/auth/middleware.js";
import type { UserRow } from "../src/db/repos/users.js";
import type { UsageQueries } from "../src/mechanisms/observability.js";
import type { Access } from "../src/mechanisms/projects.js";
import type { UsageQuery } from "../src/services/usage-service.js";
import { usageRoutes } from "../src/http/routes/usage.js";

/** Any response will do: the route serializes it and nothing here reads its fields. */
const EMPTY_USAGE = { groupBy: "date" } as unknown as UsageResponse;

/** The two paths every case asks for, both with the same query and a different Project. */
const READ_P1 = "/api/projects/p1/usage?groupBy=date&granularity=day&from=2026-10-01&to=2026-10-18";
const READ_P2 = "/api/projects/p2/usage?groupBy=date&granularity=day&from=2026-10-01&to=2026-10-18";

/** A viewer the route reads `userId` and `isAdmin` off; the rest of the row is never touched. */
function viewer(isAdmin: boolean): UserRow {
  return {
    userId: "user-1",
    passwordHash: "",
    isAdmin,
    passwordIsInitial: false,
    displayName: null,
    avatar: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A stand-in Project gate: every case here is allowed in (helpers.ts's accessDouble). */
function accessDouble(): Access {
  return {
    requireProjectAccess: () => ({}) as never,
    requireProjectOwner: () => ({}) as never,
  } as unknown as Access;
}

/**
 * A UsageQueries double recording every query it runs, in order. `answer` decides what one call
 * resolves to — a test makes it reject, or holds it open — and `query` is the route's only way
 * in, so its call count is the number of times the route actually went to the service.
 */
function serviceDouble(
  answer: (projectId: string, q: UsageQuery) => Promise<UsageResponse> = async () => EMPTY_USAGE,
) {
  const calls: Array<{ projectId: string; q: UsageQuery }> = [];
  const query = vi.fn(async (projectId: string, q: UsageQuery) => {
    calls.push({ projectId, q });
    return answer(projectId, q);
  });
  return { service: { query } as unknown as UsageQueries, calls, query };
}

/** The usage route alone, behind a middleware that puts `who` on the context as the caller. */
function usageApp(service: UsageQueries, who: () => UserRow): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("user", who());
    c.set("sessionVia", "password");
    await next();
  });
  app.route(
    "/api/projects/:projectId/usage",
    usageRoutes({ access: accessDouble(), usageService: service }),
  );
  return app;
}

describe("GET /api/projects/:projectId/usage", () => {
  it("serves a repeat inside the TTL from the entry, without querying again", async () => {
    const { service, query } = serviceDouble();
    const app = usageApp(service, () => viewer(false));

    const first = await app.request(READ_P1);
    const second = await app.request(READ_P1);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("queries again once the TTL has passed", async () => {
    const { service, query } = serviceDouble();
    const app = usageApp(service, () => viewer(false));

    vi.useFakeTimers();
    try {
      await app.request(READ_P1);
      // The TTL is the 30s key bucket: 29 seconds in, the entry still stands...
      vi.advanceTimersByTime(29_000);
      await app.request(READ_P1);
      expect(query).toHaveBeenCalledTimes(1);
      // ...and past it, the next read goes back to the service.
      vi.advanceTimersByTime(2_000);
      await app.request(READ_P1);
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares one entry between polls whose rolling window stays inside a 30s bucket", async () => {
    const { service, query } = serviceDouble();
    const app = usageApp(service, () => viewer(false));
    const poll = (toTs: string) =>
      app.request(
        `/api/projects/p1/usage?granularity=day&fromTs=2026-10-18T10:00:00.000Z&toTs=${toTs}`,
      );

    await poll("2026-10-18T10:05:00.000Z");
    await poll("2026-10-18T10:05:29.000Z");

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("keeps the two sides of a 30s boundary apart", async () => {
    const { service, query, calls } = serviceDouble();
    const app = usageApp(service, () => viewer(false));
    const poll = (toTs: string) =>
      app.request(
        `/api/projects/p1/usage?granularity=day&fromTs=2026-10-18T10:00:00.000Z&toTs=${toTs}`,
      );

    await poll("2026-10-18T10:05:29.000Z");
    await poll("2026-10-18T10:05:30.000Z");

    expect(query).toHaveBeenCalledTimes(2);
    // Bucketing is the key's business: the query the service runs still carries the exact
    // instant the caller asked for.
    expect(calls[1]!.q.toTs).toBe("2026-10-18T10:05:30.000Z");
  });

  it("keeps two Projects' identical reads apart", async () => {
    const { service, query, calls } = serviceDouble();
    const app = usageApp(service, () => viewer(false));

    await app.request(READ_P1);
    await app.request(READ_P2);

    expect(query).toHaveBeenCalledTimes(2);
    expect(calls.map((call) => call.projectId)).toEqual(["p1", "p2"]);
  });

  it("never answers a member with the admin's rows", async () => {
    const { service, query, calls } = serviceDouble();
    let isAdmin = false;
    const app = usageApp(service, () => viewer(isAdmin));

    await app.request(READ_P1);
    isAdmin = true;
    await app.request(READ_P1);

    expect(query).toHaveBeenCalledTimes(2);
    expect(calls.map((call) => call.q.includeGlobalErrors)).toEqual([false, true]);
  });

  it("does not cache a failed query", async () => {
    let failing = true;
    const { service, query } = serviceDouble(async () => {
      if (failing) throw new Error("the repository is unreachable");
      return EMPTY_USAGE;
    });
    const app = usageApp(service, () => viewer(false));

    expect((await app.request(READ_P1)).status).toBe(500);

    failing = false;
    // A cached failure, or a slot never cleared, would answer this from the dead query.
    expect((await app.request(READ_P1)).status).toBe(200);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("issues one query for two concurrent identical requests", async () => {
    let release!: (body: UsageResponse) => void;
    const gate = new Promise<UsageResponse>((resolve) => (release = resolve));
    const { service, query } = serviceDouble(() => gate);
    const app = usageApp(service, () => viewer(false));

    const first = app.request(READ_P1);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    const second = app.request(READ_P1);
    release(EMPTY_USAGE);

    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
