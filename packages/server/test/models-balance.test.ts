/**
 * Group balances (GET /api/projects/:p/models/balance): the server asks the vendor endpoint
 * the catalog's `balance` descriptor names, with the group's stored key, and answers with a
 * small reading or a typed failure — never the key, never the vendor's own text.
 *
 * The vendors are stood in for at the wire: `fetch` is stubbed globally, which is the call the
 * reader really makes (the server routes it through the proxy dispatcher in production), so
 * the URL, the Bearer header and each vendor's documented reply shape are all exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_CATALOG } from "@prismshadow/penguin-core";
import type { ModelBalanceResponse, ProjectCreateResponse } from "../src/api/types.js";
import {
  BALANCE_CACHE_MS,
  ModelBalances,
  microToDecimal,
  readBalance,
} from "../src/services/model-balance.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const TOKENDANCE_URL = "https://tokendance.space/portal/api/v1/user/balance";
const DEEPSEEK_URL = "https://api.deepseek.com/user/balance";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** TokenDance's documented reply (https://tokendance.space/docs/open-api), in micro-yuan. */
const TOKENDANCE_REPLY = {
  balance: { credits: 58000000, credits_used: 57837189, balance: 162811 },
};

/** DeepSeek's documented reply, with a second currency riding along. */
const DEEPSEEK_REPLY = {
  is_available: true,
  balance_infos: [
    {
      currency: "CNY",
      total_balance: "110.00",
      granted_balance: "10.00",
      topped_up_balance: "100.00",
    },
    { currency: "USD", total_balance: "5.00", granted_balance: "0.00", topped_up_balance: "5.00" },
  ],
};

interface VendorCall {
  url: string;
  authorization: string | null;
}

/**
 * Stubs the global fetch with a stand-in for the two vendors: every call to a balance URL is
 * recorded, and `answer` decides the reply. Anything else the app fetches meanwhile is
 * refused and left out of the record.
 */
function stubVendors(answer: (url: string) => Response | Promise<Response>): VendorCall[] {
  const calls: VendorCall[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== TOKENDANCE_URL && url !== DEEPSEEK_URL) throw new Error(`unexpected fetch ${url}`);
    calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    return answer(url);
  });
  return calls;
}

describe("GET /api/projects/:p/models/balance", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  const tokenDanceRow = MODEL_CATALOG.find((m) => m.provider === "tokendance" && !m.retired)!;
  const balance = (provider: string, force = false) =>
    owner.get(
      `/api/projects/${projectId}/models/balance?provider=${provider}${force ? "&force=1" : ""}`,
    );
  /**
   * Narrows the table to one preset of each balance group and stores the given keys on them
   * (an omitted key keeps the stored one, as on the models page).
   */
  const storeKeys = async (keys: { tokendance?: string; deepseek?: string }) => {
    const res = await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "deepseek", modelId: "deepseek-v4-pro" },
      models: [
        {
          provider: "tokendance",
          modelId: tokenDanceRow.modelId,
          ...(keys.tokendance !== undefined ? { apiKey: keys.tokendance } : {}),
        },
        {
          provider: "deepseek",
          modelId: "deepseek-v4-pro",
          ...(keys.deepseek !== undefined ? { apiKey: keys.deepseek } : {}),
        },
      ],
    });
    expect(res.status).toBe(200);
  };

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "alice");
    owner = apiClient(t.app, cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "alice-balance", name: "Balances" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await t.cleanup();
  });

  it("TokenDance: reads balance.balance in micro-yuan as CNY yuan, asking with the group's stored key", async () => {
    await storeKeys({ tokendance: "sk-td-secret-0001" });
    const calls = stubVendors(() => json(200, TOKENDANCE_REPLY));
    const res = await balance("tokendance");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("sk-td-secret-0001");
    const body = JSON.parse(text) as ModelBalanceResponse;
    expect(body).toMatchObject({
      ok: true,
      provider: "tokendance",
      amount: "0.162811",
      currency: "CNY",
    });
    expect(Date.parse(body.fetchedAt)).not.toBeNaN();
    expect(calls).toEqual([{ url: TOKENDANCE_URL, authorization: "Bearer sk-td-secret-0001" }]);
  });

  it("DeepSeek: the first currency is the headline, the others ride along, is_available passes through", async () => {
    await storeKeys({ deepseek: "sk-ds-secret-0002" });
    const calls = stubVendors(() => json(200, DEEPSEEK_REPLY));
    const body = (await (await balance("deepseek")).json()) as ModelBalanceResponse;
    expect(body).toMatchObject({
      ok: true,
      provider: "deepseek",
      amount: "110.00",
      currency: "CNY",
      available: true,
      others: [{ amount: "5.00", currency: "USD" }],
    });
    expect(calls).toEqual([{ url: DEEPSEEK_URL, authorization: "Bearer sk-ds-secret-0002" }]);
  });

  it("a group with no stored key answers no_key, and nobody is called", async () => {
    const calls = stubVendors(() => json(200, TOKENDANCE_REPLY));
    const res = await balance("tokendance");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, provider: "tokendance", error: "no_key" });
    expect(calls).toEqual([]);
  });

  it("a group without a balance endpoint answers unsupported; a missing provider is a bad request", async () => {
    await storeKeys({ tokendance: "sk-td-secret-0001" });
    const calls = stubVendors(() => json(200, TOKENDANCE_REPLY));
    for (const provider of ["openrouter", "custom", "no-such-group"]) {
      expect(await (await balance(provider)).json(), provider).toMatchObject({
        ok: false,
        error: "unsupported",
      });
    }
    expect((await owner.get(`/api/projects/${projectId}/models/balance`)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("a vendor failure is an answer, carrying the status and none of the vendor's text", async () => {
    await storeKeys({ tokendance: "sk-td-secret-0001", deepseek: "sk-ds-secret-0002" });
    stubVendors((url) =>
      url === DEEPSEEK_URL
        ? json(401, {
            error: { message: "Authentication Fails, Your api key: ****0002 is invalid" },
          })
        : json(200, { balance: { credits: 58000000 } }),
    );
    const refused = await balance("deepseek");
    expect(refused.status).toBe(200);
    const refusedText = await refused.text();
    expect(refusedText).not.toContain("Authentication Fails");
    expect(refusedText).not.toContain("0002");
    expect(JSON.parse(refusedText)).toMatchObject({
      ok: false,
      error: "upstream_failed",
      status: 401,
    });
    // A reply without the documented figure is a failure, never a zero.
    expect(await (await balance("tokendance")).json()).toMatchObject({
      ok: false,
      error: "upstream_failed",
    });

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await (await balance("deepseek", true)).json()).toMatchObject({
      ok: false,
      error: "upstream_failed",
    });
  });

  it("answers from the cache for the same key, asks again on force or for a new key", async () => {
    await storeKeys({ tokendance: "sk-td-secret-0001" });
    const calls = stubVendors(() => json(200, TOKENDANCE_REPLY));
    const first = (await (await balance("tokendance")).json()) as ModelBalanceResponse;
    const second = (await (await balance("tokendance")).json()) as ModelBalanceResponse;
    expect(calls).toHaveLength(1);
    // The cached answer keeps the time it was read at.
    expect(second).toEqual(first);

    await balance("tokendance", true);
    expect(calls).toHaveLength(2);

    // A new authorization writes a new key: the old account's balance must not be served.
    await storeKeys({ tokendance: "sk-td-secret-0003" });
    await balance("tokendance");
    expect(calls).toHaveLength(3);
    expect(calls[2]!.authorization).toBe("Bearer sk-td-secret-0003");
  });

  it("any member may read a Project's balances; a stranger may not", async () => {
    await storeKeys({ tokendance: "sk-td-secret-0001" });
    stubVendors(() => json(200, TOKENDANCE_REPLY));
    const bob = await provisionUser(t.app, "bob");
    expect((await owner.post(`/api/projects/${projectId}/members`, { userId: "bob" })).status).toBe(
      201,
    );
    const asBob = apiClient(t.app, bob.cookie);
    const read = await asBob.get(`/api/projects/${projectId}/models/balance?provider=tokendance`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ ok: true, amount: "0.162811" });
    const carol = await provisionUser(t.app, "carol");
    const asCarol = apiClient(t.app, carol.cookie);
    const refused = await asCarol.get(
      `/api/projects/${projectId}/models/balance?provider=tokendance`,
    );
    expect(refused.status).toBe(404);
  });
});

describe("ModelBalances", () => {
  it("serves a cached answer for 60 s, then asks again", async () => {
    let now = 1_700_000_000_000;
    let calls = 0;
    const balances = new ModelBalances({
      groupKey: async () => "sk-td-secret-0001",
      fetchImpl: (async () => {
        calls += 1;
        return json(200, TOKENDANCE_REPLY);
      }) as unknown as typeof fetch,
      now: () => now,
    });
    await balances.read("p1", "tokendance");
    now += BALANCE_CACHE_MS - 1;
    await balances.read("p1", "tokendance");
    expect(calls).toBe(1);
    now += 1;
    await balances.read("p1", "tokendance");
    expect(calls).toBe(2);
    // Per Project: another Project's key is another account.
    await balances.read("p2", "tokendance");
    expect(calls).toBe(3);
  });

  it("shares one vendor call between readers asking at the same time", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const balances = new ModelBalances({
      groupKey: async () => "sk-td-secret-0001",
      fetchImpl: (async () => {
        calls += 1;
        await gate;
        return json(200, TOKENDANCE_REPLY);
      }) as unknown as typeof fetch,
    });
    const both = Promise.all([
      balances.read("p1", "tokendance"),
      balances.read("p1", "tokendance"),
    ]);
    // Both reads have looked the key up and reached the vendor by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const [a, b] = await both;
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });
});

describe("balance readers", () => {
  it("microToDecimal keeps every stated digit and writes at least two decimals", () => {
    expect(microToDecimal(162811)).toBe("0.162811");
    expect(microToDecimal(110_000_000)).toBe("110.00");
    expect(microToDecimal(1_500_000)).toBe("1.50");
    expect(microToDecimal(0)).toBe("0.00");
    expect(microToDecimal(-2_500_000)).toBe("-2.50");
  });

  it("TokenDance: balance.balance, as a number or a numeric string, with or without an envelope", () => {
    expect(readBalance("tokendance", TOKENDANCE_REPLY)).toEqual({
      amount: "0.162811",
      currency: "CNY",
    });
    expect(readBalance("tokendance", { data: { balance: { balance: "2000000" } } })).toEqual({
      amount: "2.00",
      currency: "CNY",
    });
    for (const body of [{}, { balance: 5 }, { balance: { balance: "lots" } }, null, "5"]) {
      expect(readBalance("tokendance", body), JSON.stringify(body)).toBeUndefined();
    }
  });

  it("DeepSeek: entries that are not a currency with a decimal amount are skipped, none left is a failure", () => {
    expect(
      readBalance("deepseek", {
        balance_infos: [
          { currency: "cny", total_balance: "1.00" },
          { currency: "USD", total_balance: "n/a" },
          { currency: "USD", total_balance: "7.25" },
        ],
      }),
    ).toEqual({ amount: "7.25", currency: "USD" });
    expect(readBalance("deepseek", { is_available: false, balance_infos: [] })).toBeUndefined();
    expect(readBalance("deepseek", { balance_infos: "none" })).toBeUndefined();
  });
});
