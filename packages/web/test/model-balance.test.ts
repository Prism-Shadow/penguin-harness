/**
 * Group balances in the Web App: how an amount reads (balance.ts), what the header and the
 * sidebar show for each state of a reading (group-balance.tsx), how the per-account pin is read
 * back out of the free-form prefs, and the TokenDance banner's per-browser dismissal.
 */
import { describe, expect, it } from "vitest";
import type { ModelBalanceResponse } from "@prismshadow/penguin-server/api";
import {
  formatAmount,
  formatBalance,
  isPinned,
  parsePinnedBalance,
} from "../src/features/models/balance";
import { balanceView } from "../src/features/models/group-balance";
import {
  TOKENDANCE_BANNER_DISMISSED_KEY,
  bannerDismissed,
} from "../src/features/models/tokendance-banner";
import { S } from "../src/lib/strings";

const reading: ModelBalanceResponse = {
  ok: true,
  provider: "deepseek",
  amount: "110.00",
  currency: "CNY",
  others: [{ amount: "5", currency: "USD" }],
  fetchedAt: "2026-09-30T06:05:00.000Z",
};

describe("formatting an amount", () => {
  it("writes two decimals with the common symbol, or the code where there is none", () => {
    expect(formatAmount({ amount: "110.00", currency: "CNY" })).toBe("¥110.00");
    expect(formatAmount({ amount: "0.162811", currency: "CNY" })).toBe("¥0.16");
    expect(formatAmount({ amount: "5", currency: "USD" })).toBe("$5.00");
    expect(formatAmount({ amount: "12.5", currency: "EUR" })).toBe("EUR 12.50");
  });

  it("lists every currency a reading holds, the headline first", () => {
    expect(reading.ok && formatBalance(reading)).toBe("¥110.00 · $5.00");
  });
});

describe("what a balance reads as", () => {
  it("a reading: the amounts, with the group and the time in the tooltip", () => {
    const view = balanceView({ loading: false, answer: reading }, "DeepSeek");
    expect(view.text).toBe("¥110.00 · $5.00");
    expect(view.title).toContain("DeepSeek");
    expect(view.title).not.toContain(S.models.balanceUnavailable);
  });

  it("an account the vendor says cannot make requests says so in the tooltip", () => {
    const view = balanceView(
      { loading: false, answer: { ...reading, available: false } },
      "DeepSeek",
    );
    expect(view.title).toContain(S.models.balanceUnavailable);
  });

  it("no balance is a muted dash, the reason and the vendor's status in the tooltip", () => {
    const view = balanceView(
      {
        loading: false,
        answer: {
          ok: false,
          provider: "tokendance",
          error: "upstream_failed",
          status: 401,
          message: "TokenDance answered the balance request with HTTP 401.",
          fetchedAt: reading.fetchedAt,
        },
      },
      "TokenDance",
    );
    expect(view.text).toBe("—");
    expect(view.title).toContain(S.models.balanceErrors.upstream_failed!);
    expect(view.title).toContain("401");
  });

  it("a request that failed outright is a dash too; nothing read yet is not", () => {
    expect(balanceView({ loading: false, requestError: "Network error" }, "TokenDance")).toEqual({
      text: "—",
      title: "Network error",
    });
    expect(balanceView(undefined, "TokenDance").text).toBe("…");
    expect(balanceView({ loading: true }, "TokenDance").text).toBe("…");
  });
});

describe("the pinned balance", () => {
  it("reads a stored pin, and anything else as nothing pinned", () => {
    expect(parsePinnedBalance({ projectId: "p1", provider: "tokendance" })).toEqual({
      projectId: "p1",
      provider: "tokendance",
    });
    for (const raw of [
      undefined,
      null,
      "p1",
      [],
      {},
      { projectId: "p1" },
      { projectId: "", provider: "x" },
    ]) {
      expect(parsePinnedBalance(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("names one Project's group: the same group in another Project is another balance", () => {
    const pin = { projectId: "p1", provider: "tokendance" };
    expect(isPinned(pin, "p1", "tokendance")).toBe(true);
    expect(isPinned(pin, "p2", "tokendance")).toBe(false);
    expect(isPinned(pin, "p1", "deepseek")).toBe(false);
    expect(isPinned(null, "p1", "tokendance")).toBe(false);
  });
});

describe("the TokenDance banner's dismissal", () => {
  it("is remembered per browser under its own key", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(bannerDismissed(storage)).toBe(false);
    storage.setItem(TOKENDANCE_BANNER_DISMISSED_KEY, "1");
    expect(bannerDismissed(storage)).toBe(true);
  });

  it("a storage that refuses to answer shows the banner rather than failing", () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    expect(bannerDismissed(broken)).toBe(false);
  });
});
