/**
 * Group balances: the readings the models page shows in a group's header, and the one balance
 * pinned beside the user name in the sidebar.
 *
 * - **Readings** live in one module-level store keyed by Project and group, so both places
 *   show the same value — a refresh clicked on the page updates the pinned copy too — and one
 *   request in flight per key serves every reader asking at once. The server caches for 60 s
 *   as well; a click asks it to skip that (`force`).
 * - **The pin** is stored per ACCOUNT, in `ui_prefs.pinnedBalance`, following the precedent of
 *   `todoDismissed` (lib/todo-dismissals.ts): a user who pins a balance expects it wherever they
 *   sign in, and on a shared machine another user must not inherit it. `PUT /me/prefs` merges
 *   at the top level, so the field is always written whole; `null` is "nothing pinned". Until
 *   the prefs arrive the pin reads as absent, so nothing appears and then vanishes.
 */
import { useEffect } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand/react";
import type {
  ModelBalanceAmount,
  ModelBalanceReading,
  ModelBalanceResponse,
  PinnedBalance,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";

// —— Formatting (pure) ——

const CURRENCY_SYMBOL: Readonly<Record<string, string>> = { CNY: "¥", USD: "$" };

/** One amount as money is read: two decimals, the symbol where there is a common one ("¥110.00"), the code otherwise ("EUR 12.00"). */
export function formatAmount({ amount, currency }: ModelBalanceAmount): string {
  const value = Number(amount);
  const fixed = Number.isFinite(value) ? value.toFixed(2) : amount;
  const symbol = CURRENCY_SYMBOL[currency];
  return symbol !== undefined ? `${symbol}${fixed}` : `${currency} ${fixed}`;
}

/** Every currency a reading holds, the headline first: "¥110.00 · $5.00". */
export function formatBalance(reading: ModelBalanceReading): string {
  return [reading, ...(reading.others ?? [])].map(formatAmount).join(" · ");
}

// —— Readings ——

export interface BalanceState {
  /** A request is in flight; the previous answer, if any, stays on screen meanwhile. */
  loading: boolean;
  /** The server's last answer: a reading, or a typed reason there is none. */
  answer?: ModelBalanceResponse;
  /** The request itself failed (network, access), already worded for the tooltip. */
  requestError?: string;
}

const readingsStore = createStore<{ readings: Readonly<Record<string, BalanceState>> }>(() => ({
  readings: {},
}));

const inflight = new Map<string, Promise<void>>();

/** The newest request per key: an older one that lands after it (a refresh click overtook it) is dropped. */
const latest = new Map<string, number>();
let requestSeq = 0;

function readingKey(projectId: string, provider: string): string {
  return `${projectId}\u0000${provider}`;
}

function setReading(key: string, next: (prev: BalanceState | undefined) => BalanceState): void {
  const { readings } = readingsStore.getState();
  readingsStore.setState({ readings: { ...readings, [key]: next(readings[key]) } });
}

/**
 * Reads one group's balance into the store. A request already in flight for the same key is
 * joined rather than repeated — unless this one is a refresh click, which the in-flight one may
 * predate.
 */
export function requestBalance(projectId: string, provider: string, force = false): Promise<void> {
  const key = readingKey(projectId, provider);
  const pending = inflight.get(key);
  if (pending !== undefined && !force) return pending;
  setReading(key, (prev) => ({ ...prev, loading: true }));
  const mine = ++requestSeq;
  latest.set(key, mine);
  const call = api
    .getModelBalance(projectId, provider, force)
    .then((answer) => {
      if (latest.get(key) === mine) setReading(key, () => ({ loading: false, answer }));
    })
    .catch((error: unknown) => {
      if (latest.get(key) !== mine) return;
      setReading(key, (prev) => ({
        loading: false,
        ...(prev?.answer !== undefined ? { answer: prev.answer } : {}),
        requestError: apiErrorText(error),
      }));
    })
    .finally(() => {
      if (inflight.get(key) === call) inflight.delete(key);
    });
  inflight.set(key, call);
  return call;
}

/** Reactive read of one group's balance; undefined until something asked for it. */
export function useBalance(projectId: string | null, provider: string): BalanceState | undefined {
  return useStore(readingsStore, (s) =>
    projectId === null ? undefined : s.readings[readingKey(projectId, provider)],
  );
}

// —— The pin ——

/** The `ui_prefs` key the pin is stored under. */
export const PINNED_BALANCE_PREFS_KEY = "pinnedBalance";

/** The stored pin, or null for anything that is not one (absent, cleared, or malformed). */
export function parsePinnedBalance(raw: unknown): PinnedBalance | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { projectId, provider } = raw as Record<string, unknown>;
  if (typeof projectId !== "string" || projectId === "") return null;
  if (typeof provider !== "string" || provider === "") return null;
  return { projectId, provider };
}

/** Whether a pin names this Project's group. */
export function isPinned(pin: PinnedBalance | null, projectId: string, provider: string): boolean {
  return pin !== null && pin.projectId === projectId && pin.provider === provider;
}

/** `undefined` until the prefs have been read; `null` when nothing is pinned. */
const pinStore = createStore<{ pin: PinnedBalance | null | undefined }>(() => ({ pin: undefined }));

let hydrating = false;

function hydratePin(): void {
  if (hydrating || pinStore.getState().pin !== undefined) return;
  hydrating = true;
  void api
    .getPrefs()
    .then(({ prefs }) => {
      // A pin set in this tab while the read was in flight is newer than what it read.
      if (pinStore.getState().pin === undefined) {
        pinStore.setState({ pin: parsePinnedBalance(prefs[PINNED_BALANCE_PREFS_KEY]) });
      }
    })
    .catch(() => {
      // Left unread so a later mount retries; showing no pin meanwhile is the quiet direction.
      hydrating = false;
    });
}

/**
 * The pinned balance, or null while nothing is pinned or the prefs are still unread. Every
 * caller reads the prefs once per page load at most.
 */
export function usePinnedBalance(): PinnedBalance | null {
  useEffect(() => hydratePin(), []);
  return useStore(pinStore, (s) => s.pin ?? null);
}

/** Pins one balance beside the user name, replacing any other, or clears the pin (null). */
export function setPinnedBalance(pin: PinnedBalance | null): void {
  pinStore.setState({ pin });
  // Fire-and-forget, like the other per-account markers: a lost write costs persistence only.
  void api.putPrefs({ [PINNED_BALANCE_PREFS_KEY]: pin }).catch(() => undefined);
}
