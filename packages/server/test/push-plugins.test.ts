/**
 * The serving side of a push that meets plugins its build cannot run (hmr/push-plugins.ts),
 * over HTTP and through the real mechanism: the route registers the slip, the pushed
 * generation answers on it, and the route turns that into what the pusher reads — a 409 with
 * the list, or the accepted push's outcome with what it left out.
 *
 * The pushed platform here is a stand-in that speaks the slip exactly as the real one does
 * (the real platform's half is push-plugins-boot.test.ts): pushing the real bundle through a
 * test app would need a build of it.
 */
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AppEnv } from "../src/auth/middleware.js";
import type { UnsatisfiedPlugin } from "../src/api/types.js";
import {
  LEAVE_OUT,
  PUSH_SLIP_RESOURCE_ID,
  UNSATISFIED_PLUGINS_HEADER,
} from "../src/hmr/push-plugins.js";
import type { PluginsUnsatisfiedBody } from "../src/hmr/push-plugins.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const MINIMAL_CLI = "export async function cli(argv) { return 0; }\n";
const MINIMAL_WEB = { "index.html": Buffer.from("<html>push</html>").toString("base64") };

const UNSATISFIED: UnsatisfiedPlugin[] = [
  { specifier: "@acme/partial", disabled: false, reason: "contributes to 'nowhere.slot'" },
  { specifier: "@acme/unmet", disabled: true, reason: "names interface 'Nope'" },
];

async function push(
  app: Hono<AppEnv>,
  cookie: string,
  platform: string,
  headers: Record<string, string> = {},
) {
  const gz = zlib.gzipSync(
    Buffer.from(JSON.stringify({ platform, cli: MINIMAL_CLI, web: { files: MINIMAL_WEB } })),
  );
  return app.request("/api/hmr/upgrade", {
    method: "POST",
    headers: { cookie, "content-type": "application/gzip", ...headers },
    body: gz,
  });
}

/**
 * A platform serving `/api/demo/who` and the upgrade channel. `meets` is what its build
 * cannot run: with any, it treats the slip as the real platform does — refuse when the
 * pusher has not accepted, otherwise boot and report. `boom` fails the boot for a reason of
 * its own.
 */
function platform(id: string, opts: { meets?: UnsatisfiedPlugin[]; boom?: boolean } = {}): string {
  return `
const anySchema = {
  strictParse: (doc) => ({ ok: true, value: doc === undefined ? {} : doc }),
  describe: () => ({ kind: "any" }),
};
const iface = { kind: "iface", name: "platform", version: 1, context: anySchema, methods: ["park", "info"], children: {}, migrations: {} };
const MEETS = ${JSON.stringify(opts.meets ?? [])};
const impl = {
  create(ctx, context) {
    if (${JSON.stringify(opts.boom === true)}) throw new Error("boom");
    const claimed = ctx.resources.claim(${JSON.stringify(PUSH_SLIP_RESOURCE_ID)});
    const slip = claimed && claimed.taken !== true ? claimed : null;
    if (slip) slip.taken = true;
    if (MEETS.length > 0 && slip) {
      slip.unsatisfied = MEETS;
      if (!slip.leaveOut) {
        slip.refused = true;
        throw new Error("this build cannot fully run some installed plugins");
      }
    }
    return {
      park: () => context,
      info: () => ({ impl: ${JSON.stringify(id)} }),
      http(request) {
        const { pathname } = new URL(request.url);
        if (pathname.startsWith("/api/hmr/")) return ctx.resources.claim("platform.hmrControl").endpoint(request);
        if (pathname !== "/api/demo/who") return null;
        return new Response(JSON.stringify({ servedBy: ${JSON.stringify(id)} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    };
  },
};
export const hotPlatform = { id: ${JSON.stringify(id)}, iface, impl, context: {} };
`;
}

describe("a push that meets plugins its build cannot run", () => {
  let t: TestApp;
  let cookie: string;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    cookie = (await loginAdmin(t.app)).cookie;
    api = apiClient(t.app, cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const slipRegistered = () => t.deps.hmr.resources.claim(PUSH_SLIP_RESOURCE_ID) !== undefined;

  it("is refused with the list when the pusher has not accepted, and the running version keeps serving", async () => {
    const res = await push(t.app, cookie, platform("asks", { meets: UNSATISFIED }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as PluginsUnsatisfiedBody;
    expect(body.error.code).toBe("plugins_unsatisfied");
    expect(body.error.plugins).toEqual(UNSATISFIED);
    // The message alone tells a client that knows nothing of this what to send.
    expect(body.error.message).toContain("@acme/partial (would run without part of itself)");
    expect(body.error.message).toContain("@acme/unmet (would be disabled)");
    expect(body.error.message).toContain(`${UNSATISFIED_PLUGINS_HEADER}: ${LEAVE_OUT}`);
    // The generation that served the push was restored: its own API answers, the pushed one's does not.
    expect((await api.get("/api/me")).status).toBe(200);
    expect((await api.get("/api/demo/who")).status).toBe(404);
    expect(slipRegistered()).toBe(false);
  });

  it("goes through once accepted, and the outcome names what was left out", async () => {
    const refused = await push(t.app, cookie, platform("asks", { meets: UNSATISFIED }));
    expect(refused.status).toBe(409);
    const res = await push(t.app, cookie, platform("asks", { meets: UNSATISFIED }), {
      [UNSATISFIED_PLUGINS_HEADER]: LEAVE_OUT,
    });
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as {
      status: string;
      unsatisfiedPlugins?: UnsatisfiedPlugin[];
    };
    expect(outcome.status).toBe("ok");
    expect(outcome.unsatisfiedPlugins).toEqual(UNSATISFIED);
    expect(await (await api.get("/api/demo/who")).json()).toEqual({ servedBy: "asks" });
    expect(slipRegistered()).toBe(false);
  });

  it("answers as the mechanism does when the build fits every plugin", async () => {
    const res = await push(t.app, cookie, platform("fits"));
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as Record<string, unknown>;
    expect(outcome.status).toBe("ok");
    expect("unsatisfiedPlugins" in outcome).toBe(false);
    expect(slipRegistered()).toBe(false);
  });

  it("leaves a boot that failed for another reason as the mechanism's refusal", async () => {
    const res = await push(t.app, cookie, platform("boom", { boom: true }), {
      [UNSATISFIED_PLUGINS_HEADER]: LEAVE_OUT,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toMatch(/boom/);
    expect((await api.get("/api/me")).status).toBe(200);
    expect(slipRegistered()).toBe(false);
  });
});
