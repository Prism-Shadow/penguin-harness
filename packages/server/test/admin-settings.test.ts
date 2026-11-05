/**
 * Admin server settings, as the admin page reads and writes them through /api/admin/settings,
 * and the proxy reachability probe that rides the same route.
 *
 * - Given a non-admin, every settings and probe route answers 403, and nothing is written.
 * - Given no stored rows, the settings read as their defaults: both proxy switches on, no
 *   explicit address, company mode off, the default upload limits.
 * - Given the legacy single proxy switch stored off, both switches read off, and setting one
 *   of them writes only its own key.
 * - A PUT persists each proxy switch independently and echoes the full settings.
 * - A PUT changes only the fields it names; an empty PUT changes nothing.
 * - A PUT carrying any invalid field is refused and writes none of its fields (the PUT is
 *   atomic across the switches, the address and the upload limits).
 * - The proxy address is stored and echoed in its normalized form; a bad one is refused as
 *   `invalid_proxy_url`; empty, blank and null clear it back to the environment.
 * - Upload limits: a valid pair persists and is what the server reads per request; a value
 *   outside the range is refused as `invalid_attachment_limit`; the range's extremes are
 *   accepted; the total may not sit below the per-file cap, checked against the effective
 *   pair after the write.
 * - A probe outcome is named by what came back: any HTTP answer is reachable, a transport
 *   failure is named by the errno underneath it, and a proxy refusing the CONNECT tunnel is
 *   not a timeout.
 * - Probing each listed target makes one credential-free request to exactly the listed URL,
 *   and each answer is reported on its own.
 * - A provider id outside the fixed list is a 404 that reaches no network.
 *
 * One app serves the file: every case starts from an empty settings table. The probe's fetch
 * is always the fake, so no case depends on the network.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProxyProbeDto,
  ProxyProbeResponse,
  ProxyProbeTargetsResponse,
  ServerSettings,
  ServerSettingsResponse,
} from "../src/api/types.js";
import { classifyProxyProbe } from "../src/services/proxy-probe.js";
import {
  DEFAULT_ATTACHMENT_MAX_MB,
  DEFAULT_ATTACHMENT_TOTAL_MB,
  MAX_ATTACHMENT_MB,
  MIN_ATTACHMENT_MB,
} from "../src/services/attachment-limits.js";
import { fetchFailed, stubFetch } from "./fixtures/fetch.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("admin server settings", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    t.deps.db.exec("DELETE FROM server_settings");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const getSettings = async (): Promise<ServerSettings> => {
    const res = await admin.get("/api/admin/settings");
    expect(res.status).toBe(200);
    return ((await res.json()) as ServerSettingsResponse).settings;
  };
  const put = (body: unknown) => admin.put("/api/admin/settings", body);
  const errorCode = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;

  it("a non-admin gets 403 from every settings and probe route, and writes nothing", async () => {
    const { cookie } = await provisionUser(t.app, "norm");
    const api = apiClient(t.app, cookie);
    expect((await api.get("/api/admin/settings")).status).toBe(403);
    expect((await api.put("/api/admin/settings", { proxyForApp: false })).status).toBe(403);
    expect((await api.put("/api/admin/settings", { attachmentMaxMb: 1 })).status).toBe(403);
    // The probe reaches the network on the server's behalf, so it sits behind the same gate,
    // and so does the list of what it would reach.
    expect((await api.get("/api/admin/settings/proxy-probe")).status).toBe(403);
    expect((await api.post("/api/admin/settings/proxy-probe/openai")).status).toBe(403);
    const settings = await getSettings();
    expect(settings.proxyForApp).toBe(true);
    expect(settings.attachmentMaxMb).toBe(DEFAULT_ATTACHMENT_MAX_MB);
  });

  it("with no stored rows, the settings read as their defaults", async () => {
    expect(await getSettings()).toMatchObject({
      proxyForApp: true,
      proxyForAgent: true,
      proxyUrl: null,
      // Company mode is the one switch that starts off: an admin opts the server into it.
      companyMode: false,
      attachmentMaxMb: DEFAULT_ATTACHMENT_MAX_MB,
      attachmentTotalMb: DEFAULT_ATTACHMENT_TOTAL_MB,
    });
  });

  it("a legacy single proxy switch set off turns both switches off until each is set", async () => {
    // The single switch shipped only on unreleased main (#225): a deployment that had
    // toggled it off keeps that choice for both new switches, with no migration — the legacy
    // key is read as a fallback, never rewritten.
    t.deps.serverSettingsRepo.set("use_system_proxy", "false");
    expect(await getSettings()).toMatchObject({ proxyForApp: false, proxyForAgent: false });
    // Setting one new switch writes only its own key: the other still follows the legacy one.
    await put({ proxyForApp: true });
    expect(await getSettings()).toMatchObject({ proxyForApp: true, proxyForAgent: false });
    expect(t.deps.serverSettingsRepo.get("use_system_proxy")).toBe("false");
  });

  it("a PUT persists each proxy switch independently and echoes the full settings", async () => {
    const appOff = await put({ proxyForApp: false });
    expect(appOff.status).toBe(200);
    expect(((await appOff.json()) as ServerSettingsResponse).settings).toMatchObject({
      proxyForApp: false,
      proxyForAgent: true,
    });
    expect((await put({ proxyForAgent: false })).status).toBe(200);
    expect(await getSettings()).toMatchObject({ proxyForApp: false, proxyForAgent: false });
  });

  it("a PUT changes only the fields it names", async () => {
    await put({ proxyForApp: false, proxyForAgent: false });
    // An empty PUT is a no-op that still answers with the current settings.
    const noop = await put({});
    expect(noop.status).toBe(200);
    expect(((await noop.json()) as ServerSettingsResponse).settings.proxyForApp).toBe(false);
    // Address only: the switches keep their values…
    await put({ proxyUrl: "proxy.corp.example:8080" });
    expect(await getSettings()).toMatchObject({
      proxyForApp: false,
      proxyForAgent: false,
      proxyUrl: "http://proxy.corp.example:8080",
    });
    // …and switches only: the address keeps its value.
    await put({ proxyForApp: true, proxyForAgent: true });
    expect(await getSettings()).toMatchObject({
      proxyForApp: true,
      proxyForAgent: true,
      proxyUrl: "http://proxy.corp.example:8080",
    });
  });

  it.each([
    ["a non-boolean app switch", { proxyForApp: "on" }],
    ["a non-boolean agent switch", { proxyForAgent: 1 }],
    [
      "a bad address beside valid switches",
      { proxyForApp: false, proxyForAgent: false, proxyUrl: "not a proxy" },
    ],
    ["a bad upload limit beside a valid switch", { proxyForApp: false, attachmentMaxMb: 999999 }],
  ])("a PUT carrying %s is refused and writes none of its fields", async (_case, body) => {
    const before = await getSettings();
    expect((await put(body)).status).toBe(400);
    expect(await getSettings()).toEqual(before);
  });

  it("stores and echoes the proxy address in its normalized form", async () => {
    // Bare host[:port] shorthand is read as http://; the unit suite covers the rest of the forms.
    const res = await put({ proxyUrl: "  proxy.corp.example:8080 " });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ServerSettingsResponse).settings.proxyUrl).toBe(
      "http://proxy.corp.example:8080",
    );
    expect((await getSettings()).proxyUrl).toBe("http://proxy.corp.example:8080");
  });

  it("refuses a bad proxy address as invalid_proxy_url and keeps the stored one", async () => {
    await put({ proxyUrl: "http://proxy.corp.example:8080" });
    // socks4 parses as a URL but undici's dispatcher refuses to construct from it.
    for (const bad of ["socks4://proxy.corp.example:1080", "not a proxy", 42]) {
      const res = await put({ proxyUrl: bad });
      expect(res.status, String(bad)).toBe(400);
      expect(await errorCode(res)).toBe("invalid_proxy_url");
    }
    expect((await getSettings()).proxyUrl).toBe("http://proxy.corp.example:8080");
  });

  it("clears the address back to the environment with an empty, blank or null value", async () => {
    for (const clear of ["", "   ", null]) {
      await put({ proxyUrl: "http://proxy.corp.example:8080" });
      const res = await put({ proxyUrl: clear });
      expect(res.status).toBe(200);
      expect(((await res.json()) as ServerSettingsResponse).settings.proxyUrl).toBeNull();
      expect((await getSettings()).proxyUrl).toBeNull();
    }
  });

  it("a valid pair of upload limits persists and is what the server reads per request", async () => {
    const res = await put({ attachmentMaxMb: 25, attachmentTotalMb: 40 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ServerSettingsResponse).settings).toMatchObject({
      attachmentMaxMb: 25,
      attachmentTotalMb: 40,
    });
    // The repo is what the validators and the body cap read per request: the response echoing
    // the right number would not prove the server uses it.
    expect(t.deps.serverSettingsRepo.getAttachmentLimitsMb()).toEqual({
      attachmentMaxMb: 25,
      attachmentTotalMb: 40,
    });
  });

  it("refuses an upload limit outside the range as invalid_attachment_limit", async () => {
    // 102400 is "100GB" typed into a MB field — the case the bounds exist for. Zero, a
    // negative, a fraction and a string are the other ways a form can produce nonsense.
    for (const bad of [102400, MAX_ATTACHMENT_MB + 1, 0, -5, 1.5, "100", null]) {
      const res = await put({ attachmentMaxMb: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await errorCode(res)).toBe("invalid_attachment_limit");
    }
    expect((await getSettings()).attachmentMaxMb).toBe(DEFAULT_ATTACHMENT_MAX_MB);
  });

  it("accepts both extremes of the upload-limit range", async () => {
    expect(
      (await put({ attachmentMaxMb: MIN_ATTACHMENT_MB, attachmentTotalMb: MIN_ATTACHMENT_MB }))
        .status,
    ).toBe(200);
    expect(
      (await put({ attachmentMaxMb: MAX_ATTACHMENT_MB, attachmentTotalMb: MAX_ATTACHMENT_MB }))
        .status,
    ).toBe(200);
    expect((await getSettings()).attachmentMaxMb).toBe(MAX_ATTACHMENT_MB);
  });

  // Raising only the per-file cap past the stored total, or lowering only the total below the
  // stored cap, would leave a legal single attachment unsendable: the check reads the pair the
  // write would leave, not just the body.
  it.each([
    ["the body pairs a total below its cap", null, { attachmentMaxMb: 50, attachmentTotalMb: 20 }],
    ["the cap rises past the stored total", [10, 12], { attachmentMaxMb: 100 }],
    ["the total drops below the stored cap", [10, 12], { attachmentTotalMb: 5 }],
  ] as const)("refuses a total below the per-file cap when %s", async (_case, stored, body) => {
    if (stored !== null) await put({ attachmentMaxMb: stored[0], attachmentTotalMb: stored[1] });
    const before = await getSettings();
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_attachment_limit");
    expect(await getSettings()).toEqual(before);
  });

  // —— reachability probe ——

  const timedOut = Object.assign(new Error("aborted due to timeout"), { name: "TimeoutError" });
  // A proxy that refuses the CONNECT tunnel arrives as an AbortError NESTED under "fetch
  // failed": a refusal to carry the request, not a host that took too long.
  const tunnelRefused = new TypeError("fetch failed", {
    cause: Object.assign(new Error("Proxy response (403) !== 200 when HTTP Tunneling"), {
      name: "AbortError",
      code: "UND_ERR_ABORTED",
    }),
  });

  it("names a probe outcome by what came back", () => {
    // The probe carries no credential, so a rejection is the expected answer — and an answer
    // is the whole proof: the name resolved, TCP connected, TLS completed, the host replied.
    const cases = [
      ["an HTTP 401", { status: 401 }, "reachable"],
      ["an HTTP 503", { status: 503 }, "reachable"],
      ["our own timeout", { error: timedOut }, "timeout"],
      ["ENOTFOUND", { error: fetchFailed("ENOTFOUND") }, "dns"],
      ["ECONNREFUSED", { error: fetchFailed("ECONNREFUSED") }, "refused"],
      ["a self-signed cert", { error: fetchFailed("DEPTH_ZERO_SELF_SIGNED_CERT") }, "tls"],
      ["a cert name mismatch", { error: fetchFailed("ERR_TLS_CERT_ALTNAME_INVALID") }, "tls"],
      ["ENETUNREACH", { error: fetchFailed("ENETUNREACH") }, "network"],
      ["a refused CONNECT tunnel", { error: tunnelRefused }, "network"],
    ] as const;
    for (const [label, attempt, outcome] of cases) {
      expect(classifyProxyProbe(attempt), label).toBe(outcome);
    }
  });

  it("probes each listed target once, without a credential, at exactly the listed URL", async () => {
    const listed = (await (
      await admin.get("/api/admin/settings/proxy-probe")
    ).json()) as ProxyProbeTargetsResponse;
    expect(listed.targets.map((target) => target.provider)).toContain("deepseek");

    // Every provider key the process could reach for is present, so "no credential is sent"
    // is a claim about the code rather than about an empty environment.
    for (const key of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GEMINI_API_KEY",
      "DEEPSEEK_API_KEY",
      "ZAI_API_KEY",
    ]) {
      vi.stubEnv(key, `secret-${key}`);
    }
    const fake = stubFetch((call) => {
      // One dead target proves the others are reported independently rather than as a batch.
      if (call.url.includes("deepseek")) throw fetchFailed("ECONNREFUSED");
      return new Response("{}", { status: 401 });
    });

    // One call per provider, the way the page fires them: each answer renders as it lands.
    const probes: ProxyProbeDto[] = [];
    for (const target of listed.targets) {
      const res = await admin.post(`/api/admin/settings/proxy-probe/${target.provider}`);
      expect(res.status).toBe(200);
      probes.push(((await res.json()) as ProxyProbeResponse).probe);
    }

    // Each answer names its own target, so a row cannot be filled from another's result.
    expect(probes.map((p) => [p.provider, p.url])).toEqual(
      listed.targets.map((target) => [target.provider, target.url]),
    );
    for (const probe of probes) {
      expect(probe.outcome).toBe(probe.provider === "deepseek" ? "refused" : "reachable");
      expect(probe.ms).toBeGreaterThanOrEqual(0);
    }
    // What was listed is exactly what was fetched, over https, and not one credential rides
    // along under any header name or in the query string.
    expect(fake.calls.map((call) => call.url)).toEqual(listed.targets.map((target) => target.url));
    for (const call of fake.calls) {
      expect(call.url.startsWith("https://")).toBe(true);
      const sent = `${call.url} ${[...call.headers].map(([k, v]) => `${k}: ${v}`).join(" ")}`;
      expect(sent).not.toContain("secret-");
      expect(call.headers.get("authorization")).toBeNull();
    }
  });

  it("answers 404 to a provider id outside the fixed list, and reaches no network", async () => {
    const fake = stubFetch(() => new Response("{}", { status: 200 }));
    // The route takes an id and never a URL, so an id nobody put in the list must not become
    // a fetch of anything — which is why this endpoint has no request body.
    for (const provider of ["evil", "openai/../evil", "https://evil.example", "OPENAI", ""]) {
      const res = await admin.post(
        `/api/admin/settings/proxy-probe/${encodeURIComponent(provider)}`,
      );
      expect(res.status, provider).toBe(404);
    }
    expect(fake.calls).toEqual([]);
  });
});
