/**
 * Admin server-settings route tests: permission boundary (non-admin 403), the proxy
 * defaults (absent rows read as both switches on, no explicit address), adoption of the
 * legacy single-switch key, PUT persistence and validation (proxy-address normalization
 * and rejection), and merge semantics (an omitted field keeps its current value; a
 * rejected PUT writes nothing).
 *
 * The upload limits ride the same route and are covered here too: their defaults, the bounded
 * range (the reason "100GB" is a clear refusal rather than an accepted number), the relation
 * between the two — the total may not sit below the per-file cap, checked against the EFFECTIVE
 * post-write pair so a one-field PUT cannot create an unsendable configuration — and the same
 * atomicity guarantee the proxy fields have.
 *
 * The reachability probe rides the same route too: the rule that decides reachable from
 * unreachable, and the endpoint around it. Its fetch is always stubbed — a test that reached a
 * real provider would fail on an offline machine and turn CI into a network monitor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProxyProbeResponse,
  ProxyProbeTargetsResponse,
  ServerSettingsResponse,
} from "../src/api/types.js";
import { classifyProxyProbe } from "../src/services/proxy-probe.js";
import {
  DEFAULT_ATTACHMENT_MAX_MB,
  DEFAULT_ATTACHMENT_TOTAL_MB,
  MAX_ATTACHMENT_MB,
  MIN_ATTACHMENT_MB,
} from "../src/services/attachment-limits.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("admin server settings", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await t.cleanup();
  });

  const getSettings = async (api: ReturnType<typeof apiClient> = admin) => {
    const res = await api.get("/api/admin/settings");
    expect(res.status).toBe(200);
    return (await res.json()) as ServerSettingsResponse;
  };

  it("non-admin access is always 403", async () => {
    const { cookie } = await provisionUser(t.app, "norm");
    const api = apiClient(t.app, cookie);
    expect((await api.get("/api/admin/settings")).status).toBe(403);
    expect((await api.put("/api/admin/settings", { proxyForApp: false })).status).toBe(403);
    // The probe reaches the network on the server's behalf, so it sits behind the same gate,
    // and so does the list of what it would reach.
    expect((await api.get("/api/admin/settings/proxy-probe")).status).toBe(403);
    expect((await api.post("/api/admin/settings/proxy-probe")).status).toBe(403);
    // The failed PUT changed nothing.
    expect((await getSettings()).settings.proxyForApp).toBe(true);
  });

  it("defaults while no rows exist: both switches on, no explicit address", async () => {
    expect(t.deps.db.prepare("SELECT COUNT(*) AS n FROM server_settings").get()).toMatchObject({
      n: 0,
    });
    const { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(true);
    expect(settings.proxyForAgent).toBe(true);
    expect(settings.proxyUrl).toBeNull();
  });

  it("adopts the legacy use_system_proxy row as the default for BOTH switches", async () => {
    // The single switch shipped only on unreleased main (#225): a deployment that had
    // toggled it off must keep that choice for both new switches, with no migration —
    // the legacy key is read as a fallback, never rewritten.
    t.deps.serverSettingsRepo.set("use_system_proxy", "false");
    let { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(false);
    expect(settings.proxyForAgent).toBe(false);
    // Setting one NEW switch writes only its own key: the other still follows legacy.
    await admin.put("/api/admin/settings", { proxyForApp: true });
    ({ settings } = await getSettings());
    expect(settings.proxyForApp).toBe(true);
    expect(settings.proxyForAgent).toBe(false);
    // The legacy row itself was never touched.
    expect(t.deps.serverSettingsRepo.get("use_system_proxy")).toBe("false");
  });

  it("PUT persists the switches independently and echoes the full settings", async () => {
    const appOff = await admin.put("/api/admin/settings", { proxyForApp: false });
    expect(appOff.status).toBe(200);
    const afterAppOff = ((await appOff.json()) as ServerSettingsResponse).settings;
    expect(afterAppOff.proxyForApp).toBe(false);
    expect(afterAppOff.proxyForAgent).toBe(true);
    // Round-trips through the repo (the DB rows, not process state, are what GET serves).
    expect(t.deps.serverSettingsRepo.getProxyForApp()).toBe(false);
    expect(t.deps.serverSettingsRepo.getProxyForAgent()).toBe(true);

    const agentOff = await admin.put("/api/admin/settings", { proxyForAgent: false });
    expect(agentOff.status).toBe(200);
    const { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(false);
    expect(settings.proxyForAgent).toBe(false);
  });

  it("an omitted field keeps its current value; a non-boolean is 400", async () => {
    await admin.put("/api/admin/settings", { proxyForApp: false });
    // Empty PUT: no-op, still returns the current settings.
    const noop = await admin.put("/api/admin/settings", {});
    expect(noop.status).toBe(200);
    expect(((await noop.json()) as ServerSettingsResponse).settings.proxyForApp).toBe(false);
    // Type check: only booleans are accepted, and a rejected write changes nothing.
    expect((await admin.put("/api/admin/settings", { proxyForApp: "on" })).status).toBe(400);
    expect((await admin.put("/api/admin/settings", { proxyForAgent: 1 })).status).toBe(400);
    const { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(false);
    expect(settings.proxyForAgent).toBe(true);
  });

  const putProxyUrl = async (proxyUrl: unknown) => admin.put("/api/admin/settings", { proxyUrl });

  it("PUT normalizes the proxy address and stores/echoes only the normalized form", async () => {
    // Bare host[:port] shorthand → http://.
    const bare = await putProxyUrl("proxy.corp.example:8080");
    expect(bare.status).toBe(200);
    expect(((await bare.json()) as ServerSettingsResponse).settings.proxyUrl).toBe(
      "http://proxy.corp.example:8080",
    );
    expect((await getSettings()).settings.proxyUrl).toBe("http://proxy.corp.example:8080");
    expect(t.deps.serverSettingsRepo.getProxyUrl()).toBe("http://proxy.corp.example:8080");
    // https passes through; surrounding whitespace is trimmed.
    const https = await putProxyUrl("  https://proxy.corp.example:3128  ");
    expect(https.status).toBe(200);
    expect(((await https.json()) as ServerSettingsResponse).settings.proxyUrl).toBe(
      "https://proxy.corp.example:3128",
    );
    // socks5 rides through to undici's dispatcher untouched.
    const socks = await putProxyUrl("socks5://proxy.corp.example:1080");
    expect(socks.status).toBe(200);
    expect(((await socks.json()) as ServerSettingsResponse).settings.proxyUrl).toBe(
      "socks5://proxy.corp.example:1080",
    );
  });

  it("PUT rejects a bad proxy address with invalid_proxy_url and stores nothing", async () => {
    await putProxyUrl("http://proxy.corp.example:8080");
    // socks4 parses as a URL but undici's dispatcher refuses to construct from it.
    for (const bad of ["socks4://proxy.corp.example:1080", "not a proxy", 42]) {
      const res = await putProxyUrl(bad);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_proxy_url");
    }
    expect((await getSettings()).settings.proxyUrl).toBe("http://proxy.corp.example:8080");
  });

  it("a rejected combined PUT leaves the other fields untouched too", async () => {
    // Validation happens before any write: the valid switch halves of a PUT whose
    // proxyUrl is garbage must not land either — the PUT is atomic.
    const res = await admin.put("/api/admin/settings", {
      proxyForApp: false,
      proxyForAgent: false,
      proxyUrl: "not a proxy",
    });
    expect(res.status).toBe(400);
    const { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(true);
    expect(settings.proxyForAgent).toBe(true);
    expect(settings.proxyUrl).toBeNull();
  });

  it("empty string and null both clear the address back to follow-the-environment", async () => {
    for (const clear of ["", "   ", null]) {
      await putProxyUrl("http://proxy.corp.example:8080");
      const res = await putProxyUrl(clear);
      expect(res.status).toBe(200);
      expect(((await res.json()) as ServerSettingsResponse).settings.proxyUrl).toBeNull();
      expect(t.deps.serverSettingsRepo.getProxyUrl()).toBeNull();
    }
  });

  it("partial PUTs keep the other fields: address-only keeps the switches and vice versa", async () => {
    await admin.put("/api/admin/settings", { proxyForApp: false, proxyForAgent: false });
    await putProxyUrl("proxy.corp.example:8080");
    let { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(false);
    expect(settings.proxyForAgent).toBe(false);
    expect(settings.proxyUrl).toBe("http://proxy.corp.example:8080");
    await admin.put("/api/admin/settings", { proxyForApp: true, proxyForAgent: true });
    ({ settings } = await getSettings());
    expect(settings.proxyForApp).toBe(true);
    expect(settings.proxyForAgent).toBe(true);
    expect(settings.proxyUrl).toBe("http://proxy.corp.example:8080");
  });

  it("upload limits: defaults with no rows, and a 403 for a non-admin on both verbs", async () => {
    const { settings } = await getSettings();
    expect(settings.attachmentMaxMb).toBe(DEFAULT_ATTACHMENT_MAX_MB);
    expect(settings.attachmentTotalMb).toBe(DEFAULT_ATTACHMENT_TOTAL_MB);
    const { cookie } = await provisionUser(t.app, "limitless");
    const api = apiClient(t.app, cookie);
    expect((await api.get("/api/admin/settings")).status).toBe(403);
    expect((await api.put("/api/admin/settings", { attachmentMaxMb: 1 })).status).toBe(403);
    // The refused PUT wrote nothing.
    expect(t.deps.serverSettingsRepo.getAttachmentMaxMb()).toBe(DEFAULT_ATTACHMENT_MAX_MB);
  });

  it("upload limits: a valid PUT persists, echoes, and needs no restart to take effect", async () => {
    const res = await admin.put("/api/admin/settings", {
      attachmentMaxMb: 25,
      attachmentTotalMb: 40,
    });
    expect(res.status).toBe(200);
    const echoed = ((await res.json()) as ServerSettingsResponse).settings;
    expect(echoed.attachmentMaxMb).toBe(25);
    expect(echoed.attachmentTotalMb).toBe(40);
    // Round-trip through the repo, which is what the validators and the body cap read per
    // request — the response echoing the right number would not prove the server uses it.
    expect(t.deps.serverSettingsRepo.getAttachmentLimitsMb()).toEqual({
      attachmentMaxMb: 25,
      attachmentTotalMb: 40,
    });
  });

  it("upload limits: out-of-range values are refused with invalid_attachment_limit", async () => {
    // 102400 is "100GB" typed into a MB field — the case the bounds exist for. Zero, a negative,
    // a fraction and a string are the other ways a form can produce nonsense.
    for (const bad of [102400, MAX_ATTACHMENT_MB + 1, 0, -5, 1.5, "100", null]) {
      const res = await admin.put("/api/admin/settings", { attachmentMaxMb: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "invalid_attachment_limit",
      );
    }
    // Nothing was written by any of them.
    expect(t.deps.serverSettingsRepo.getAttachmentMaxMb()).toBe(DEFAULT_ATTACHMENT_MAX_MB);
  });

  it("upload limits: the extremes of the allowed range are accepted", async () => {
    const res = await admin.put("/api/admin/settings", {
      attachmentMaxMb: MIN_ATTACHMENT_MB,
      attachmentTotalMb: MIN_ATTACHMENT_MB,
    });
    expect(res.status).toBe(200);
    const max = await admin.put("/api/admin/settings", {
      attachmentMaxMb: MAX_ATTACHMENT_MB,
      attachmentTotalMb: MAX_ATTACHMENT_MB,
    });
    expect(max.status).toBe(200);
    expect(t.deps.serverSettingsRepo.getAttachmentMaxMb()).toBe(MAX_ATTACHMENT_MB);
  });

  it("upload limits: the total may not sit below the per-file cap", async () => {
    const both = await admin.put("/api/admin/settings", {
      attachmentMaxMb: 50,
      attachmentTotalMb: 20,
    });
    expect(both.status).toBe(400);
    expect(((await both.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_attachment_limit",
    );
    expect(t.deps.serverSettingsRepo.getAttachmentMaxMb()).toBe(DEFAULT_ATTACHMENT_MAX_MB);
  });

  it("upload limits: the relation is checked against the effective pair, not just the body", async () => {
    await admin.put("/api/admin/settings", { attachmentMaxMb: 10, attachmentTotalMb: 12 });
    // Raising ONLY the per-file cap past the stored total would leave a legal single attachment
    // unsendable, so it is refused even though the body carries no total at all.
    const raise = await admin.put("/api/admin/settings", { attachmentMaxMb: 100 });
    expect(raise.status).toBe(400);
    // Lowering ONLY the total below the stored per-file cap is the same fault from the other side.
    const lower = await admin.put("/api/admin/settings", { attachmentTotalMb: 5 });
    expect(lower.status).toBe(400);
    // Neither attempt changed anything.
    expect(t.deps.serverSettingsRepo.getAttachmentLimitsMb()).toEqual({
      attachmentMaxMb: 10,
      attachmentTotalMb: 12,
    });
  });

  it("upload limits: a PUT mixing a good proxy field with a bad limit writes neither", async () => {
    const res = await admin.put("/api/admin/settings", {
      proxyForApp: false,
      attachmentMaxMb: 999999,
    });
    expect(res.status).toBe(400);
    const { settings } = await getSettings();
    expect(settings.proxyForApp).toBe(true);
    expect(settings.attachmentMaxMb).toBe(DEFAULT_ATTACHMENT_MAX_MB);
  });
  // —— reachability probe ——

  /** undici's shape for a transport failure: `TypeError: fetch failed` over the real error. */
  const fetchFailed = (code: string) =>
    new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });

  it("probe classification: any HTTP answer is reachable", () => {
    // The probe carries no credential, so a rejection is the expected answer — and an answer
    // is the whole proof: the name resolved, TCP connected, TLS completed, the host replied.
    expect(classifyProxyProbe({ status: 401 })).toBe("reachable");
    expect(classifyProxyProbe({ status: 403 })).toBe("reachable");
    expect(classifyProxyProbe({ status: 404 })).toBe("reachable");
    expect(classifyProxyProbe({ status: 200 })).toBe("reachable");
    expect(classifyProxyProbe({ status: 503 })).toBe("reachable");
  });

  it("probe classification: a transport failure is named by the cause underneath it", () => {
    const timedOut = Object.assign(new Error("aborted due to timeout"), { name: "TimeoutError" });
    expect(classifyProxyProbe({ error: timedOut })).toBe("timeout");
    expect(classifyProxyProbe({ error: fetchFailed("ENOTFOUND") })).toBe("dns");
    expect(classifyProxyProbe({ error: fetchFailed("ECONNREFUSED") })).toBe("refused");
    expect(classifyProxyProbe({ error: fetchFailed("DEPTH_ZERO_SELF_SIGNED_CERT") })).toBe("tls");
    expect(classifyProxyProbe({ error: fetchFailed("ERR_TLS_CERT_ALTNAME_INVALID") })).toBe("tls");
    expect(classifyProxyProbe({ error: fetchFailed("ENETUNREACH") })).toBe("network");
    // A proxy that refuses the CONNECT tunnel arrives as an AbortError NESTED under "fetch
    // failed". That is a refusal to carry the request, not a host that took too long, so only
    // an abort on the outermost error may read as a timeout.
    const tunnelRefused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Proxy response (403) !== 200 when HTTP Tunneling"), {
        name: "AbortError",
        code: "UND_ERR_ABORTED",
      }),
    });
    expect(classifyProxyProbe({ error: tunnelRefused })).not.toBe("timeout");
  });

  it("the probe reports every provider, sends no credential, and names what it measured", async () => {
    // The page lists these before anyone presses the button, so they must be the very URLs
    // the probes then request — asserted together at the end of this test.
    const listed = (await (
      await admin.get("/api/admin/settings/proxy-probe")
    ).json()) as ProxyProbeTargetsResponse;
    expect(listed.targets.map((t) => t.provider)).toEqual([
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
    ]);

    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, init });
        // One dead target proves the others are reported independently rather than as a batch
        // that fails whole.
        if (url.includes("deepseek")) throw fetchFailed("ECONNREFUSED");
        return new Response("{}", { status: 401 });
      }),
    );
    await admin.put("/api/admin/settings", { proxyUrl: "proxy.corp.example:8080" });

    const res = await admin.post("/api/admin/settings/proxy-probe");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProxyProbeResponse;
    expect(body.probes.map((p) => p.provider)).toEqual([
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
    ]);
    expect(body.probes.filter((p) => p.outcome === "reachable").map((p) => p.status)).toEqual([
      401, 401, 401,
    ]);
    expect(body.probes.at(-1)).toMatchObject({ provider: "deepseek", outcome: "refused" });
    // Every result is timed, the failed one included.
    for (const probe of body.probes) expect(probe.ms).toBeGreaterThanOrEqual(0);
    // The answer names the STORED configuration, which is the one the connections travelled.
    expect(body).toMatchObject({ proxyForApp: true, proxyUrl: "http://proxy.corp.example:8080" });
    // What was listed is exactly what was fetched: a page that advertises one URL and probes
    // another would be lying about what "no API key" applies to.
    expect(requests.map((r) => r.url)).toEqual(listed.targets.map((t) => t.url));
    // Hard-coded https targets, and not one credential on any of them — the process
    // environment's provider keys must not leak into an unauthenticated probe.
    expect(requests).toHaveLength(4);
    for (const { url, init } of requests) {
      expect(url.startsWith("https://")).toBe(true);
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("x-api-key")).toBeNull();
    }
  });

  it("the probe follows the saved switch, so a stored address with the proxy off is not the path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    // An address survives the switch being turned off — it is remembered for the next time it
    // is turned on — and the dispatcher is a plain direct Agent in that state
    // (buildProxyDispatcher, proxy.test.ts). The answer therefore has to report the switch,
    // not just echo the address back, or the page would name a proxy nothing travelled.
    await admin.put("/api/admin/settings", {
      proxyForApp: false,
      proxyUrl: "proxy.corp.example:8080",
    });

    const body = (await (
      await admin.post("/api/admin/settings/proxy-probe")
    ).json()) as ProxyProbeResponse;
    expect(body).toMatchObject({ proxyForApp: false, proxyUrl: "http://proxy.corp.example:8080" });
    expect(body.probes.every((probe) => probe.outcome === "reachable")).toBe(true);
  });
});
