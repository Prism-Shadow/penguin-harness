/**
 * Group account balances (GET /api/projects/:p/models/balance).
 *
 * A group whose catalog entry carries a `balance` descriptor publishes an endpoint that
 * answers the balance of the account an API key belongs to. The server makes that call with
 * the group's stored key, so the key never leaves this process, and hands the page a small
 * reading in place of the vendor's own reply: an amount as a decimal string, its currency,
 * and when it was read.
 *
 * - **Readers.** One per published response shape (`ModelProviderBalance.format`), each strict
 *   about what it accepts: an answer that does not carry a number where the vendor documents
 *   one is a failure, never a zero.
 * - **Outbound.** The global `fetch`, which the server routes through the admin proxy
 *   settings (net/proxy.ts), with a 5 s limit.
 * - **Cache.** 60 s per Project and group, keyed on a digest of the key as well, so a key
 *   written by a new authorization misses it instead of serving the old account's balance.
 *   Vendor failures are cached too: a page load and a pinned balance asking at once must not
 *   become two calls to a vendor that is already failing. `force` skips the cache and
 *   refreshes it; two callers asking at once share one call.
 * - **Failures are answers** (`ok: false`), as the connectivity test's are: nothing here
 *   throws, so an unreadable balance never lands in the error center, and no vendor text is
 *   relayed — only its HTTP status.
 */
import { createHash } from "node:crypto";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderBalance } from "@prismshadow/penguin-core/model-catalog";
import type {
  ModelBalanceAmount,
  ModelBalanceFailure,
  ModelBalanceReading,
  ModelBalanceResponse,
} from "../api/types.js";

/** How long a vendor may take to answer a balance request. */
export const BALANCE_TIMEOUT_MS = 5_000;

/** How long an answer is reused for the same Project, group and key. */
export const BALANCE_CACHE_MS = 60_000;

/** What a reader takes out of a vendor's reply. */
export type BalanceFigures = Omit<ModelBalanceReading, "ok" | "provider" | "fetchedAt">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A plain decimal as a vendor writes it: optional minus, digits, optional fraction. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Micro-units (an integer) as a decimal string in the major unit, with at least two decimals
 * and no trailing zeros beyond them: 162811 → "0.162811", 110000000 → "110.00". Integer
 * arithmetic, so no binary rounding creeps into a figure the vendor states exactly.
 */
export function microToDecimal(micro: number): string {
  const whole = Math.round(Math.abs(micro));
  const sign = micro < 0 && whole !== 0 ? "-" : "";
  const units = Math.floor(whole / 1_000_000);
  const fraction = String(whole % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `${sign}${units}.${fraction}`;
}

/**
 * TokenDance (https://tokendance.space/docs/open-api): `{ balance: { credits, credits_used,
 * balance } }`, every figure in micro-yuan. The remaining balance is `balance.balance`; an
 * envelope around it (`{ data: { balance: … } }`) is read the same way.
 */
function readTokenDance(body: unknown): BalanceFigures | undefined {
  const holder = isRecord(body) && isRecord(body.data) ? body.data : body;
  const wallet = isRecord(holder) ? holder.balance : undefined;
  const raw = isRecord(wallet) ? wallet.balance : undefined;
  const micro =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && DECIMAL.test(raw)
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(micro)) return undefined;
  return { amount: microToDecimal(micro), currency: "CNY" };
}

/**
 * DeepSeek (https://api-docs.deepseek.com/api/get-user-balance): `{ is_available,
 * balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }`, one
 * entry per currency, amounts as decimal strings. The first entry is the headline; entries
 * that are not a currency code with a decimal amount are skipped rather than guessed at.
 */
function readDeepSeek(body: unknown): BalanceFigures | undefined {
  if (!isRecord(body) || !Array.isArray(body.balance_infos)) return undefined;
  const amounts: ModelBalanceAmount[] = [];
  for (const info of body.balance_infos) {
    if (!isRecord(info)) continue;
    const currency = info.currency;
    const total =
      typeof info.total_balance === "number" ? String(info.total_balance) : info.total_balance;
    if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) continue;
    if (typeof total !== "string" || !DECIMAL.test(total)) continue;
    amounts.push({ amount: total, currency });
  }
  const [first, ...others] = amounts;
  if (first === undefined) return undefined;
  return {
    ...first,
    ...(typeof body.is_available === "boolean" ? { available: body.is_available } : {}),
    ...(others.length > 0 ? { others } : {}),
  };
}

const READERS: Record<
  ModelProviderBalance["format"],
  (body: unknown) => BalanceFigures | undefined
> = {
  tokendance: readTokenDance,
  deepseek: readDeepSeek,
};

/** Reads one vendor reply; undefined when it carries no balance the reader can vouch for. */
export function readBalance(
  format: ModelProviderBalance["format"],
  body: unknown,
): BalanceFigures | undefined {
  return READERS[format](body);
}

interface CacheEntry {
  /** Digest of the key the answer was read with. */
  keyDigest: string;
  at: number;
  answer: ModelBalanceResponse;
}

export interface ModelBalanceDeps {
  /** The group's stored API key (the first of its rows that carries one), or undefined. */
  groupKey(projectId: string, provider: string): Promise<string | undefined>;
  /** Replaced in tests; defaults to the global fetch at call time, which carries the proxy settings. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Reads group balances for the models routes; one instance per route group holds the cache. */
export class ModelBalances {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<ModelBalanceResponse>>();

  constructor(private readonly deps: ModelBalanceDeps) {}

  async read(projectId: string, provider: string, force = false): Promise<ModelBalanceResponse> {
    const info = providerInfo(provider);
    const descriptor = info?.balance;
    if (info === undefined || descriptor === undefined) {
      return this.failure(provider, "unsupported", `The ${provider} group publishes no balance.`);
    }
    const key = await this.deps.groupKey(projectId, provider);
    if (key === undefined) {
      return this.failure(provider, "no_key", `The ${info.label} group stores no API key.`);
    }
    const slot = `${projectId}\u0000${provider}`;
    const keyDigest = createHash("sha256").update(key).digest("hex");
    const cached = this.cache.get(slot);
    if (
      !force &&
      cached !== undefined &&
      cached.keyDigest === keyDigest &&
      this.now() - cached.at < BALANCE_CACHE_MS
    ) {
      return cached.answer;
    }
    const flight = `${slot}\u0000${keyDigest}`;
    const pending = this.inflight.get(flight);
    if (pending !== undefined) return pending;
    const call = this.ask(provider, info.label, descriptor, key)
      .then((answer) => {
        this.cache.set(slot, { keyDigest, at: this.now(), answer });
        return answer;
      })
      .finally(() => this.inflight.delete(flight));
    this.inflight.set(flight, call);
    return call;
  }

  /** One vendor call, settled into an answer: never throws, never relays the vendor's text. */
  private async ask(
    provider: string,
    label: string,
    descriptor: ModelProviderBalance,
    key: string,
  ): Promise<ModelBalanceResponse> {
    const fetchImpl: typeof fetch = this.deps.fetchImpl ?? ((...args) => fetch(...args));
    let res: Response;
    try {
      res = await fetchImpl(descriptor.url, {
        headers: { authorization: `Bearer ${key}`, accept: "application/json" },
        signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      return this.failure(
        provider,
        "upstream_failed",
        timedOut
          ? `${label} did not answer the balance request within ${BALANCE_TIMEOUT_MS / 1000} s.`
          : `${label} could not be reached for its balance.`,
      );
    }
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined);
      return this.failure(
        provider,
        "upstream_failed",
        `${label} answered the balance request with HTTP ${res.status}.`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return this.failure(provider, "upstream_failed", `${label} answered with no JSON balance.`);
    }
    const figures = readBalance(descriptor.format, body);
    if (figures === undefined) {
      return this.failure(provider, "upstream_failed", `${label}'s answer carries no balance.`);
    }
    return { ok: true, provider, ...figures, fetchedAt: new Date(this.now()).toISOString() };
  }

  private failure(
    provider: string,
    error: ModelBalanceFailure["error"],
    message: string,
    status?: number,
  ): ModelBalanceFailure {
    return {
      ok: false,
      provider,
      error,
      ...(status !== undefined ? { status } : {}),
      message,
      fetchedAt: new Date(this.now()).toISOString(),
    };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
