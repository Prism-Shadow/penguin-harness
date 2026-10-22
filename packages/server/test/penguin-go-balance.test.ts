/**
 * Penguin Go account balances through the complete platform's HTTP routes.
 *
 * - Given a runtime without the optional Go and ModelScope configuration, the full platform
 *   boots without querying a balance, and a later request uses the production Go origin.
 * - Given an explicit Go origin, a balance request uses it even if the model group points
 *   elsewhere; only the group key is sent and only the balance reading comes back.
 * - Given no group key, nothing is borrowed: not PENGUIN_GO_API_KEY, which Penguin Go no longer
 *   reads, and never a model's own key or a vendor key.
 * - Given the same group and key, reads reuse the answer until a forced refresh or key change.
 *   A different Go origin never reuses another endpoint's reading.
 * - Given an invalid key, malformed answer or unavailable vendor, a typed failure comes back.
 * - Given a member or stranger, only the member may read the balance.
 * - Given zero, negative or large ledger integers, every digit survives the CNY conversion,
 *   regardless of the platform's display currency; missing or malformed units fail.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_CATALOG } from "../src/model-catalog/index.js";
import { ModelBalances, readBalance } from "../src/services/model-balance.js";
import type { ModelBalanceDeps } from "../src/services/model-balance.js";
import { jsonResponse, stubFetch } from "./fixtures/fetch.js";
import type { FetchFake } from "./fixtures/fetch.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const KEY = "ep_go_group_secret";
const REPLY = {
  user: { username: "private-go-account" },
  balance: { units: "110000000000000", currency: "CNY", displayCurrency: "USD", amount: 15.71 },
  key: { alias: "private-key-alias" },
};

describe.each([
  {
    name: "an older runtime's configuration",
    origin: undefined,
    url: "https://go.penguin.ooo/api/me/by-key",
  },
  {
    name: "the explicitly configured secondary domain",
    origin: "https://token.penguin.ooo",
    url: "https://token.penguin.ooo/api/me/by-key",
  },
  {
    name: "an explicit Go origin",
    origin: "http://localhost:8787",
    url: "http://localhost:8787/api/me/by-key",
  },
])("Penguin Go balances with $name", ({ origin, url }) => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let fake: FetchFake;
  let sequence = 0;
  const model = MODEL_CATALOG.find((m) => m.provider === "penguin-go" && !m.retired)!;
  const read = (force = false) =>
    owner.get(
      `/api/projects/${projectId}/models/balance?provider=penguin-go${force ? "&force=1" : ""}`,
    );
  const setKey = (apiKey: string) =>
    owner.put(`/api/projects/${projectId}/models/providers/penguin-go`, { apiKey });

  beforeAll(async () => {
    fake = stubFetch(() => {
      throw new Error("boot must not query an account");
    });
    t = await createTestApp({
      config: { penguinGoOrigin: origin, modelscopeBridgeUrl: undefined },
    });
    expect(fake.calls).toEqual([]);
    const { cookie } = await provisionUser(t.app, "go_owner");
    owner = apiClient(t.app, cookie);
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(async () => {
    projectId = `go_owner-balance_${++sequence}`;
    expect((await owner.post("/api/projects", { projectId, name: "Go balance" })).status).toBe(201);
    expect(
      (
        await owner.put(`/api/projects/${projectId}/models`, {
          defaultModel: { provider: "penguin-go", modelId: model.modelId },
          models: [{ provider: "penguin-go", modelId: model.modelId }],
        })
      ).status,
    ).toBe(200);
    fake = stubFetch(() => jsonResponse(REPLY));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("boots the full platform and reads the group account at the authorization origin", async () => {
    expect((await owner.get("/api/version")).status).toBe(200);
    expect((await setKey(KEY)).status).toBe(200);
    await owner.put(`/api/projects/${projectId}/models/providers/penguin-go`, {
      baseUrl: "https://custom-model.example/api/v1",
    });
    expect(fake.calls).toEqual([]);
    const response = await read();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      provider: "penguin-go",
      amount: "110.00",
      currency: "CNY",
    });
    for (const secret of [KEY, "private-go-account", "private-key-alias"])
      expect(text).not.toContain(secret);
    expect(fake.calls.map((c) => [c.method, c.url, c.headers.get("authorization")])).toEqual([
      ["GET", url, `Bearer ${KEY}`],
    ]);
  });

  it("borrows no environment key, the retired Go variable included: only the stored group key is sent", async () => {
    vi.stubEnv("PENGUIN_GO_API_KEY", "ep_go_env_secret");
    vi.stubEnv("OPENAI_API_KEY", "vendor-secret");
    expect(await (await read()).json()).toMatchObject({ ok: false, error: "no_key" });
    expect(fake.calls).toEqual([]);
    await setKey(KEY);
    expect(await (await read()).json()).toMatchObject({ ok: true, amount: "110.00" });
    expect(fake.calls.map((c) => c.headers.get("authorization"))).toEqual([`Bearer ${KEY}`]);
  });

  it("does not query with a model's own key or another provider's environment key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "vendor-secret");
    vi.stubEnv("DEEPSEEK_API_KEY", "other-vendor-secret");
    await owner.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "penguin-go", modelId: model.modelId, apiKey: "ep_model_only" }],
    });
    expect(await (await read()).json()).toMatchObject({ ok: false, error: "no_key" });
    expect(fake.calls).toEqual([]);
  });

  it("reuses the reading until a forced refresh or a replacement group key", async () => {
    await setKey(KEY);
    const first = await (await read()).json();
    expect(await (await read()).json()).toEqual(first);
    expect(fake.calls).toHaveLength(1);
    await read(true);
    expect(fake.calls).toHaveLength(2);
    await setKey("ep_replacement_account");
    await read();
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2]!.headers.get("authorization")).toBe("Bearer ep_replacement_account");
  });

  it("reports invalid credentials without leaking the provider's response", async () => {
    await setKey(KEY);
    fake = stubFetch(() => jsonResponse({ error: `Invalid key ${KEY}` }, 401));
    const text = await (await read()).text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: "upstream_failed", status: 401 });
  });

  it("reports malformed answers and transport failures instead of a zero balance", async () => {
    await setKey(KEY);
    fake = stubFetch(() => jsonResponse({ balance: { amount: 0 } }));
    expect(await (await read()).json()).toMatchObject({ ok: false, error: "upstream_failed" });
    fake = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await (await read(true)).json()).toMatchObject({ ok: false, error: "upstream_failed" });
  });

  it("lets a project member read the account while a stranger is refused", async () => {
    await setKey(KEY);
    const member = await provisionUser(t.app, "go_member");
    await owner.post(`/api/projects/${projectId}/members`, { userId: "go_member" });
    const memberClient = apiClient(t.app, member.cookie);
    const endpoint = `/api/projects/${projectId}/models/balance?provider=penguin-go`;
    expect(await (await memberClient.get(endpoint)).json()).toMatchObject({
      ok: true,
      amount: "110.00",
    });
    const stranger = await provisionUser(t.app, "go_stranger");
    expect((await apiClient(t.app, stranger.cookie).get(endpoint)).status).toBe(404);
  });
});

describe("Penguin Go ledger readings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps readings at the primary and secondary origins in separate cache entries", async () => {
    const fake = stubFetch((call) =>
      jsonResponse({
        balance: {
          units: call.url.includes("token.penguin.ooo") ? "14000000000000" : "7000000000000",
          currency: "CNY",
        },
      }),
    );
    const deps: ModelBalanceDeps = { groupKey: async () => KEY };
    const balances = new ModelBalances(deps);
    const first = await balances.read("go-cache", "penguin-go");
    expect(first).toMatchObject({ ok: true, amount: "7.00" });
    deps.penguinGoOrigin = "https://token.penguin.ooo";
    expect(await balances.read("go-cache", "penguin-go")).toMatchObject({
      ok: true,
      amount: "14.00",
    });
    deps.penguinGoOrigin = undefined;
    expect(await balances.read("go-cache", "penguin-go")).toEqual(first);
    expect(fake.calls.map((call) => call.url)).toEqual([
      "https://go.penguin.ooo/api/me/by-key",
      "https://token.penguin.ooo/api/me/by-key",
    ]);
  });

  it.each([
    ["0", "0.00"],
    ["-2500000000000", "-2.50"],
    ["1", "0.000000000001"],
    ["9007199254740993", "9007.199254740993"],
    ["110000000000000", "110.00"],
  ])("converts ledger units %s exactly, ignoring the platform's USD display", (units, amount) => {
    expect(readBalance("penguin-go", { ...REPLY, balance: { ...REPLY.balance, units } })).toEqual({
      amount,
      currency: "CNY",
    });
  });

  it.each([
    null,
    {},
    { balance: null },
    { balance: { units: "1", currency: "USD" } },
    ...[undefined, 1, "1.5", "1e12", "NaN", ""].map((units) => ({
      balance: { currency: "CNY", units },
    })),
  ])("refuses a missing or malformed ledger balance: %j", (body) => {
    expect(readBalance("penguin-go", body)).toBeUndefined();
  });
});
