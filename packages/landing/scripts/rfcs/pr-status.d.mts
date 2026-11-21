export type RfcPrStatus = "merged" | "open" | "draft" | "closed";

export interface RfcPrDocRef {
  id: string;
  number: string;
  title: string;
  titleZh?: string;
}

export interface RfcPrRecord {
  number: number;
  title: string;
  url: string;
  status: RfcPrStatus;
  baseRefName: string;
  headRefOid: string;
  rfcs: RfcPrDocRef[];
}

export interface RfcPrStatusCache {
  updatedAt: string;
  prs: RfcPrRecord[];
}

export const REPO_OWNER: string;
export const REPO_NAME: string;
export const RFC_LABEL: string;
export const MAX_AGE_MS: number;
export const SEED_FILE: string;
export const CACHE_FILE: string;

export function normalizePrStatus(state: string, isDraft?: boolean): RfcPrStatus;
export function extractH1Title(raw: string | undefined): string | undefined;
export function runGithubGraphql(query: string): Record<string, unknown>;
export function refreshRfcPrStatusCache(options?: {
  cache?: RfcPrStatusCache | null;
  now?: number;
  force?: boolean;
  seedAll?: boolean;
  graphql?: (query: string) => Record<string, unknown>;
}): { cache: RfcPrStatusCache; fetched: boolean };
export function loadRfcPrStatuses(options?: {
  cacheFile?: string;
  seedFile?: string;
  now?: number;
  force?: boolean;
  offline?: boolean;
  graphql?: (query: string) => Record<string, unknown>;
}): RfcPrStatusCache;
