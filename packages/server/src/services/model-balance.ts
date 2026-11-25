/**
 * Group account balances moved to the model domain package
 * (@prismshadow/penguin-library-model/model-balance, services+http+cli restack S13) — it speaks
 * only library vocabulary: the catalog's `balance` descriptor, the balance DTOs and a group-key
 * port the route owner fills. This re-export keeps the server's own import paths stable.
 */
export {
  BALANCE_CACHE_MS,
  BALANCE_TIMEOUT_MS,
  ModelBalances,
  microToDecimal,
  readBalance,
} from "@prismshadow/penguin-library-model/model-balance";
export type {
  BalanceFigures,
  ModelBalanceDeps,
} from "@prismshadow/penguin-library-model/model-balance";
