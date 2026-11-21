/**
 * Build-time GitHub PR status fetcher and daily cache for the RFC index (`request-for-comments`).
 *
 * Optimization contract:
 * - Merged PRs (`status === "merged"` with `baseRefName === "main"`) are immutable and are never
 *   queried again on subsequent refreshes.
 * - Open/draft PRs are refreshed at most once every 24 hours (`MAX_AGE_MS = 24 * 60 * 60 * 1000`)
 *   via a single batched GraphQL query that fetches all currently open `request-for-comments` PRs
 *   together with any previously open/draft PRs from the cache (to detect transitions to `merged`
 *   or `closed`).
 * - When the build environment is offline or unauthenticated, the loader falls back to the cached
 *   or committed snapshot (`src/lib/rfc-pr-status.json`).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_OWNER = "Prism-Shadow";
export const REPO_NAME = "penguin-harness";
export const RFC_LABEL = "request-for-comments";
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const SEED_FILE = join(HERE, "..", "..", "src", "lib", "rfc-pr-status.json");
export const CACHE_FILE = join(
  HERE,
  "..",
  "..",
  "node_modules",
  ".cache",
  "penguin-rfcs",
  "pr-status.json",
);

/** Canonical RFC titles for unmerged drafts retitled after their initial PR branch was opened. */
const RFC_TITLE_OVERRIDES = {
  "PRFC-0011-single-socket": {
    title: "PRFC-0011 API Socket",
    titleZh: "PRFC-0011 API Socket",
  },
};

/** Map a GitHub GraphQL PullRequest state + isDraft flag to our normalized status. */
export function normalizePrStatus(state, isDraft) {
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return isDraft ? "draft" : "open";
}

/** Extract `# H1` title from raw Markdown. */
export function extractH1Title(raw) {
  return raw?.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? undefined;
}

/** Execute a single GitHub GraphQL query via `gh api graphql`. */
export function runGithubGraphql(query) {
  const out = execFileSync("gh", ["api", "graphql", "-f", `query=${query}`], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out);
  if (parsed.errors?.length) {
    throw new Error(parsed.errors.map((e) => e.message).join("; "));
  }
  return parsed.data;
}

const PR_FIELDS = `
  number
  title
  url
  state
  isDraft
  baseRefName
  headRefOid
  files(first: 100) {
    nodes {
      path
    }
  }
`;

/**
 * Fetch RFC H1 titles for a list of `{ key, oid, path }` items in a single batched GraphQL query.
 */
function fetchBlobTitles(items, graphql = runGithubGraphql) {
  if (items.length === 0) return new Map();
  const aliases = items
    .map(
      (item, idx) =>
        `b_${idx}: object(expression: ${JSON.stringify(`${item.oid}:${item.path}`)}) { ... on Blob { text } }`,
    )
    .join("\n    ");
  const query = `{
  repository(owner: ${JSON.stringify(REPO_OWNER)}, name: ${JSON.stringify(REPO_NAME)}) {
    ${aliases}
  }
}`;
  const data = graphql(query);
  const repo = data?.repository ?? {};
  const result = new Map();
  items.forEach((item, idx) => {
    const text = repo[`b_${idx}`]?.text;
    const h1 = extractH1Title(text);
    if (h1) result.set(item.key, h1);
  });
  return result;
}

/**
 * Turn raw GraphQL PR nodes into `RfcPrRecord[]`, reusing cached `rfcs` metadata when `headRefOid`
 * is unchanged and batch-fetching any new/changed RFC Markdown headers in a single GraphQL query.
 */
export function hydratePrRecords(nodes, cachedByNumber, graphql = runGithubGraphql) {
  const blobRequests = [];
  const pendingNodes = [];

  for (const node of nodes) {
    if (!node || typeof node.number !== "number") continue;
    const status = normalizePrStatus(node.state, node.isDraft);
    const cached = cachedByNumber.get(node.number);
    const rfcPaths = (node.files?.nodes ?? [])
      .map((f) => f.path)
      .filter((p) => /^rfcs\/PRFC-\d+-.+\.md$/.test(p));

    // Reuse cached RFC metadata if headRefOid matches and rfcs are already populated.
    if (cached && cached.headRefOid === node.headRefOid && cached.rfcs?.length > 0) {
      pendingNodes.push({
        number: node.number,
        title: node.title,
        url: node.url,
        status,
        baseRefName: node.baseRefName,
        headRefOid: node.headRefOid,
        rfcs: cached.rfcs.map((r) => ({ ...r, ...RFC_TITLE_OVERRIDES[r.id] })),
      });
      continue;
    }

    const ids = [...new Set(rfcPaths.map((p) => p.slice(5).replace(/\.zh\.md$|\.md$/, "")))].sort();
    for (const id of ids) {
      const enPath = `rfcs/${id}.md`;
      const zhPath = `rfcs/${id}.zh.md`;
      if (rfcPaths.includes(enPath)) {
        blobRequests.push({
          key: `${node.number}:${id}:en`,
          oid: node.headRefOid,
          path: enPath,
        });
      }
      if (rfcPaths.includes(zhPath)) {
        blobRequests.push({
          key: `${node.number}:${id}:zh`,
          oid: node.headRefOid,
          path: zhPath,
        });
      }
    }
    pendingNodes.push({
      number: node.number,
      title: node.title,
      url: node.url,
      status,
      baseRefName: node.baseRefName,
      headRefOid: node.headRefOid,
      ids,
    });
  }

  const titles = fetchBlobTitles(blobRequests, graphql);

  return pendingNodes
    .map((item) => {
      if (item.rfcs) return item;
      const rfcs = (item.ids ?? []).map((id) => {
        const number = id.match(/^PRFC-\d+/)?.[0] ?? id;
        const override = RFC_TITLE_OVERRIDES[id];
        const title =
          override?.title ??
          titles.get(`${item.number}:${id}:en`) ??
          `${number} ${id.replace(/^PRFC-\d+-/, "")}`;
        const titleZh = override?.titleZh ?? titles.get(`${item.number}:${id}:zh`);
        return titleZh ? { id, number, title, titleZh } : { id, number, title };
      });
      return {
        number: item.number,
        title: item.title,
        url: item.url,
        status: item.status,
        baseRefName: item.baseRefName,
        headRefOid: item.headRefOid,
        rfcs,
      };
    })
    .sort((a, b) => a.number - b.number);
}

/**
 * Refresh the RFC PR status cache:
 * - If `cache` is younger than `MAX_AGE_MS` (24 hours) and `!force`, returns `cache` with zero
 *   network calls.
 * - Otherwise, keeps all `merged` PRs as-is (never re-fetched) and executes ONE GraphQL query for:
 *   1. All currently `OPEN` PRs labeled `request-for-comments`
 *   2. Any previously `open` or `draft` PRs in the cache (to catch transitions to `merged`/`closed`).
 * - When `seedAll` is true (or `cache` has no PRs yet), queries `[OPEN, MERGED, CLOSED]` labeled
 *   `request-for-comments` in one call.
 */
export function refreshRfcPrStatusCache({
  cache = null,
  now = Date.now(),
  force = false,
  seedAll = false,
  graphql = runGithubGraphql,
} = {}) {
  const hasCache = Boolean(cache && Array.isArray(cache.prs) && cache.prs.length > 0);
  if (hasCache && !force && !seedAll && cache.updatedAt) {
    const age = now - Date.parse(cache.updatedAt);
    if (Number.isFinite(age) && age >= 0 && age < MAX_AGE_MS) {
      return { cache, fetched: false };
    }
  }

  const existingPrs = hasCache ? cache.prs : [];
  const cachedByNumber = new Map(existingPrs.map((p) => [p.number, p]));

  if (!hasCache || seedAll) {
    const query = `{
  repository(owner: ${JSON.stringify(REPO_OWNER)}, name: ${JSON.stringify(REPO_NAME)}) {
    pullRequests(states: [OPEN, MERGED, CLOSED], labels: [${JSON.stringify(RFC_LABEL)}], first: 100, orderBy: {field: CREATED_AT, direction: ASC}) {
      nodes { ${PR_FIELDS} }
    }
  }
}`;
    const data = graphql(query);
    const nodes = data?.repository?.pullRequests?.nodes ?? [];
    const prs = hydratePrRecords(nodes, cachedByNumber, graphql);
    return {
      cache: { updatedAt: new Date(now).toISOString(), prs },
      fetched: true,
    };
  }

  // Optimization: merged PRs are never re-fetched; closed PRs stay unless re-opened (covered by states: [OPEN]).
  // Only query currently OPEN PRs + aliases for previously open/draft PRs.
  const immutableMerged = existingPrs.filter((p) => p.status === "merged");
  const immutableNumbers = new Set(immutableMerged.map((p) => p.number));
  const previouslyOpen = existingPrs.filter(
    (p) => (p.status === "open" || p.status === "draft") && !immutableNumbers.has(p.number),
  );
  const previousClosed = existingPrs.filter(
    (p) => p.status === "closed" && !immutableNumbers.has(p.number),
  );

  const trackedAliases = previouslyOpen
    .map((p) => `pr_${p.number}: pullRequest(number: ${p.number}) { ${PR_FIELDS} }`)
    .join("\n    ");

  const query = `{
  repository(owner: ${JSON.stringify(REPO_OWNER)}, name: ${JSON.stringify(REPO_NAME)}) {
    openPrs: pullRequests(states: [OPEN], labels: [${JSON.stringify(RFC_LABEL)}], first: 100, orderBy: {field: CREATED_AT, direction: ASC}) {
      nodes { ${PR_FIELDS} }
    }
    ${trackedAliases}
  }
}`;

  const data = graphql(query);
  const repo = data?.repository ?? {};
  const byNumber = new Map();

  for (const node of repo.openPrs?.nodes ?? []) {
    if (node && !immutableNumbers.has(node.number)) {
      byNumber.set(node.number, node);
    }
  }
  for (const p of previouslyOpen) {
    const node = repo[`pr_${p.number}`];
    if (node && !byNumber.has(node.number) && !immutableNumbers.has(node.number)) {
      byNumber.set(node.number, node);
    }
  }

  const refreshedRecords = hydratePrRecords([...byNumber.values()], cachedByNumber, graphql);
  const refreshedNumbers = new Set(refreshedRecords.map((r) => r.number));
  const keptClosed = previousClosed.filter((p) => !refreshedNumbers.has(p.number));

  const prs = [...immutableMerged, ...keptClosed, ...refreshedRecords].sort(
    (a, b) => a.number - b.number,
  );
  return {
    cache: { updatedAt: new Date(now).toISOString(), prs },
    fetched: true,
  };
}

function readJsonIfExists(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Load the RFC PR status list at build time: reads the local cache (seeded from
 * `src/lib/rfc-pr-status.json`), refreshes open PRs if the cache is older than 24 hours, and
 * falls back to the cached/seed data when offline.
 */
export function loadRfcPrStatuses({
  cacheFile = CACHE_FILE,
  seedFile = SEED_FILE,
  now = Date.now(),
  force = false,
  offline = false,
  graphql = runGithubGraphql,
} = {}) {
  const seedNewer =
    existsSync(seedFile) &&
    existsSync(cacheFile) &&
    statSync(seedFile).mtimeMs >= statSync(cacheFile).mtimeMs;
  const cached = seedNewer
    ? (readJsonIfExists(seedFile) ?? readJsonIfExists(cacheFile))
    : (readJsonIfExists(cacheFile) ?? readJsonIfExists(seedFile));
  if (offline && cached) return cached;
  try {
    const { cache, fetched } = refreshRfcPrStatusCache({
      cache: cached,
      now,
      force,
      graphql,
    });
    if (fetched || !existsSync(cacheFile)) {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
    }
    return cache;
  } catch {
    if (cached) return cached;
    return { updatedAt: new Date(now).toISOString(), prs: [] };
  }
}
