/**
 * The RFC index: the repository's rfcs/ surface and its `request-for-comments` GitHub PR statuses,
 * read at build time, one entry per PRFC document pair. Merged documents render as in-site pages;
 * open, draft, and closed RFCs link to the GitHub PRs carrying them.
 */
import { prs as rawPrRecords } from "virtual:penguin-rfc-prs";
import { slugifyHeading } from "@prismshadow/penguin-ui/site";
import type { SiteSearchRange } from "@prismshadow/penguin-ui/site";
import { REPO_URL } from "./links";

/** GitHub pull-request status of an RFC (`request-for-comments`). */
export type RfcStatus = "merged" | "open" | "draft" | "closed";

export interface RfcPrDocRef {
  id: string;
  number: string;
  title: string;
  titleZh?: string;
  version?: string;
}

export interface RfcPrRecord {
  number: number;
  title: string;
  url: string;
  status: RfcStatus;
  baseRefName: string;
  headRefOid: string;
  rfcs: RfcPrDocRef[];
}

export interface RfcEditionPr {
  number: number;
  title: string;
  url: string;
  status: RfcStatus;
  version?: string;
}

/** One language version of a document: the in-site page that renders it, and the raw document. */
export interface RfcDocument {
  /** The in-site route of this version, e.g. `/rfcs/PRFC-0001-module` for the English page. */
  href: string;
  /** The document's file name in the repository's RFC directory. */
  file: string;
  /** The raw Markdown, title and provenance marker included. */
  raw: string;
}

/** A landing page linking outside the site: an open design PR carrying a revision or a draft. */
export interface ExternalDocument {
  href: string;
}

export interface RfcEntry {
  /** The document pair's name, e.g. `PRFC-0001-module`. */
  id: string;
  /** The PRFC number, e.g. `PRFC-0001`. */
  number: string;
  title: string;
  titleZh?: string;
  status: RfcStatus;
  /** The GitHub PR number carrying this RFC, when known from PR status records. */
  prNumber?: number;
  /** The GitHub PR title carrying this RFC, when known from PR status records. */
  prTitle?: string;
  /** The GitHub PR carrying this RFC, when known from PR status records or provenance markers. */
  prHref?: string;
  /** The English and Chinese in-site pages; absent while unmerged in `rfcs/`. */
  en?: RfcDocument;
  zh?: RfcDocument;
  /** An open PR carrying a revision newer than this merged version, if any. */
  openRevision?: ExternalDocument;
  /** All opening (`open` or `draft`) PRs for this RFC that are not its main version. */
  openEditions?: RfcEditionPr[];
}

export interface ParsedDocument {
  file: string;
  raw: string;
  id: string;
  zh: boolean;
  title: string;
  status: RfcStatus;
  prHref?: string;
  openRevisionHref?: string;
}

export interface RfcPagerItem {
  id: string;
  href: string;
  title: string;
}

export interface RfcTreeNode {
  key: string;
  label?: string;
  entry?: RfcEntry;
  editionPr?: RfcEditionPr;
  children?: RfcTreeNode[];
}

export const RFC_TREE_COLLAPSED_STORAGE_KEY = "penguin-rfc-tree-collapsed-v1";

/** SemVer 2.0 format required by `check-rfcs` (`vMAJOR.MINOR.PATCH`, e.g. `v0.0.1`, `v0.1.0`, `v1.0.0`). */
const RFC_SEMVER_REGEX =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Whether `version` is a valid SemVer 2.0 RFC version (`vMAJOR.MINOR.PATCH` and not `v0.0.0`). */
export function isValidRfcSemver(version: string): boolean {
  const m = RFC_SEMVER_REGEX.exec(version.trim());
  if (!m) return false;
  return Number(m[1]) !== 0 || Number(m[2]) !== 0 || Number(m[3]) !== 0;
}

/**
 * Whether `version` is a major version of an RFC:
 * - `v0.0.1`, `v0.0.2` (when `major === 0 && minor === 0 && patch > 0`)
 * - `v0.1.0`, `v0.2.0` / `v0.1`, `v0.2` (when `major === 0 && minor > 0 && patch === 0`)
 * - `v1.0.0`, `v2.0.0` / `v1`, `v2` (when `major > 0 && minor === 0 && patch === 0`)
 * Pre-release versions (e.g. `v1.0.0-alpha.1`) and non-zero minor/patch releases (e.g. `v0.1.2`,
 * `v1.1.0`, `v1.2.0`) are not major versions; optional `+build` metadata is ignored.
 */
export function isMajorRfcVersion(version: string): boolean {
  const m =
    /^v?(0|[1-9]\d*)(?:\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version.trim(),
    );
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2] ?? "0");
  const patch = Number(m[3] ?? "0");
  const nonZeroCount = (major > 0 ? 1 : 0) + (minor > 0 ? 1 : 0) + (patch > 0 ? 1 : 0);
  return nonZeroCount === 1;
}

function comparePreReleaseIdentifiers(preA: string, preB: string): number {
  const partsA = preA.split(".");
  const partsB = preB.split(".");
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i += 1) {
    const idA = partsA[i];
    const idB = partsB[i];
    if (idA === undefined) return -1;
    if (idB === undefined) return 1;
    if (idA === idB) continue;
    const numA = /^(?:0|[1-9]\d*)$/.test(idA);
    const numB = /^(?:0|[1-9]\d*)$/.test(idB);
    if (numA && numB) return Number(idA) - Number(idB);
    if (numA) return -1;
    if (numB) return 1;
    return idA < idB ? -1 : 1;
  }
  return 0;
}

export function compareRfcVersionTuple(a?: string, b?: string): number {
  const parse = (
    v?: string,
  ): { major: number; minor: number; patch: number; pre: string } | null => {
    const m =
      /^v?(0|[1-9]\d*)(?:\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?)?(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
        (v ?? "").trim(),
      );
    if (!m) return null;
    const major = Number(m[1]);
    const minor = Number(m[2] ?? "0");
    const patch = Number(m[3] ?? "0");
    if (major === 0 && minor === 0 && patch === 0) return null;
    return { major, minor, patch, pre: m[4] ?? "" };
  };
  const ta = parse(a);
  const tb = parse(b);
  if (!ta && !tb) return 0;
  if (!ta) return -1;
  if (!tb) return 1;
  const core = ta.major - tb.major || ta.minor - tb.minor || ta.patch - tb.patch;
  if (core !== 0) return core;
  if (!ta.pre && !tb.pre) return 0;
  if (!ta.pre && tb.pre) return 1;
  if (ta.pre && !tb.pre) return -1;
  return comparePreReleaseIdentifiers(ta.pre, tb.pre);
}

function pickLastMajorRfcPr(items: readonly { pr: RfcPrRecord; ref: RfcPrDocRef }[]): {
  pr: RfcPrRecord;
  ref: RfcPrDocRef;
} {
  const explicitMajor = items
    .filter(({ ref }) => Boolean(ref.version && isMajorRfcVersion(ref.version)))
    .slice()
    .sort(
      (a, b) => compareRfcVersionTuple(a.ref.version, b.ref.version) || a.pr.number - b.pr.number,
    );
  if (explicitMajor.length > 0) return explicitMajor.at(-1)!;
  const unversioned = items.filter(({ ref }) => !ref.version);
  if (unversioned.length > 0) return unversioned.at(-1)!;
  return items.at(-1)!;
}

export interface RfcSearchRecord {
  href: string;
  anchor: string;
  pageTitle: string;
  heading: string;
  text: string;
  normalizedTitle: string;
  normalizedHeading: string;
  normalizedText: string;
}

export interface RfcSearchHit {
  record: RfcSearchRecord;
  score: number;
  snippet: string;
}

/** A document is landed when its marker names where it landed, or says it is native to this repository. */
const LANDED = /\blanded\b|lands on the default branch|native to this repository|落地/;

/** The header a document's marker lives in: everything before its first `## ` section. */
function headerOf(raw: string): string {
  const body = raw.indexOf("\n## ");
  return body === -1 ? raw : raw.slice(0, body);
}

function pullHref(line: string): string | undefined {
  return line.match(/\((https:\/\/github\.com\/[^)\s]+\/pull\/\d+)\)/)?.[1];
}

/** Read one document file (PRFC-NNNN-slug.md or its .zh.md pair) into its index facts. */
export function parseRfcDocument(file: string, raw: string): ParsedDocument | null {
  if (!/^PRFC-\d+-.+\.md$/.test(file)) return null;
  const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!title) return null;
  const header = headerOf(raw);
  const lines = header.split("\n").filter((line) => line.trim().length > 0);
  const landed = lines.some((line) => LANDED.test(line));
  const prHref = lines.map(pullHref).find(Boolean);
  const openRevisionHref = lines
    .filter((line) => /Unmerged revision|未合并修订/.test(line))
    .map(pullHref)
    .find(Boolean);
  return {
    file,
    raw,
    id: file.replace(/\.zh\.md$|\.md$/, ""),
    zh: file.endsWith(".zh.md"),
    title,
    status: landed ? "merged" : prHref ? "open" : "draft",
    prHref,
    openRevisionHref,
  };
}

/** A document's copy in the repository, linked from its in-site page. */
export function repositoryHref(file: string): string {
  return `${REPO_URL}/blob/main/rfcs/${file}`;
}

/**
 * Build the index from the rfcs/ directory's raw documents and the `request-for-comments` GitHub PR
 * records: pairs merged, sorted by number. Each merged version's href names the in-site page that
 * renders it (`/rfcs/<id>` or `/rfcs/<id>.zh`); unmerged RFCs from PR records carry the PR's
 * GitHub status (`open`, `draft`, or `closed`) and link to that PR.
 */
export function buildRfcIndex(
  documents: Record<string, string>,
  prRecords: readonly RfcPrRecord[] = [],
): RfcEntry[] {
  const pairs = new Map<string, { en?: ParsedDocument; zh?: ParsedDocument }>();
  for (const [path, raw] of Object.entries(documents)) {
    const file = path.slice(path.lastIndexOf("/") + 1);
    const parsed = parseRfcDocument(file, raw);
    if (!parsed) continue;
    const pair = pairs.get(parsed.id) ?? {};
    pair[parsed.zh ? "zh" : "en"] = parsed;
    pairs.set(parsed.id, pair);
  }

  const mainPrs = prRecords
    .filter((pr) => !pr.baseRefName || pr.baseRefName === "main")
    .slice()
    .sort((a, b) => a.number - b.number);

  const settledPrUrls = new Set(
    mainPrs.filter((pr) => pr.status === "merged" || pr.status === "closed").map((pr) => pr.url),
  );
  const closedPrByUrl = new Map(
    mainPrs.filter((pr) => pr.status === "closed").map((pr) => [pr.url, pr]),
  );
  const closedPrByRfcId = new Map<string, RfcPrRecord>();
  for (const pr of mainPrs) {
    if (pr.status !== "closed") continue;
    for (const ref of pr.rfcs ?? []) {
      closedPrByRfcId.set(ref.id, pr);
    }
  }

  const itemsByRfcId = new Map<string, { pr: RfcPrRecord; ref: RfcPrDocRef }[]>();
  for (const pr of mainPrs) {
    if (pr.status === "closed") continue;
    for (const ref of pr.rfcs ?? []) {
      const list = itemsByRfcId.get(ref.id) ?? [];
      if (!list.some((item) => item.pr.number === pr.number)) {
        list.push({ pr, ref });
      }
      itemsByRfcId.set(ref.id, list);
    }
  }

  const resolvedPrByRfcId = new Map<
    string,
    {
      main: { pr: RfcPrRecord; ref: RfcPrDocRef };
      openEditions: RfcEditionPr[];
    }
  >();

  for (const [id, items] of itemsByRfcId) {
    const mergedItems = items.filter(({ pr }) => pr.status === "merged");
    const openingItems = items.filter(({ pr }) => pr.status === "open" || pr.status === "draft");

    const main =
      mergedItems.length > 0 ? pickLastMajorRfcPr(mergedItems) : pickLastMajorRfcPr(openingItems);

    const openEditions: RfcEditionPr[] = openingItems
      .filter(({ pr }) => pr.number !== main.pr.number)
      .map(({ pr, ref }) => ({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        status: pr.status,
        ...(ref.version ? { version: ref.version } : {}),
      }));

    resolvedPrByRfcId.set(id, { main, openEditions });
  }

  const entriesById = new Map<string, RfcEntry>();
  for (const [id, { en, zh }] of pairs) {
    const resolved = resolvedPrByRfcId.get(id);
    const mainPr = resolved?.main.pr;
    const openEditions = resolved?.openEditions ?? [];
    const docStatus = en?.status ?? zh?.status ?? "draft";
    const docPrHref = en?.prHref ?? zh?.prHref;
    const closedPr =
      !mainPr && docStatus !== "merged"
        ? ((docPrHref ? closedPrByUrl.get(docPrHref) : undefined) ?? closedPrByRfcId.get(id))
        : undefined;
    const effectivePr = mainPr ?? closedPr;
    const status: RfcStatus =
      docStatus === "merged" ? "merged" : (effectivePr?.status ?? docStatus);
    const linked = (doc?: ParsedDocument): RfcDocument | undefined => {
      if (!doc || status === "draft" || status === "closed") return undefined;
      if (status === "open") {
        const href = effectivePr?.url ?? doc.prHref;
        return href ? { href, file: doc.file, raw: doc.raw } : undefined;
      }
      return { href: inSiteHref(doc.id, doc.zh), file: doc.file, raw: doc.raw };
    };
    const docOpenRevHref = en?.openRevisionHref ?? zh?.openRevisionHref;
    const validDocOpenRevHref =
      docOpenRevHref && !settledPrUrls.has(docOpenRevHref) ? docOpenRevHref : undefined;
    const openRevisionHref =
      (status === "merged" ? openEditions[0]?.url : undefined) ?? validDocOpenRevHref;
    const prHref = effectivePr?.url ?? docPrHref;
    entriesById.set(id, {
      id,
      number: id.match(/^PRFC-\d+/)?.[0] ?? id,
      title: en?.title ?? zh!.title,
      titleZh: zh?.title,
      status,
      ...(effectivePr?.number ? { prNumber: effectivePr.number } : {}),
      ...(effectivePr?.title ? { prTitle: effectivePr.title } : {}),
      ...(prHref ? { prHref } : {}),
      en: linked(en),
      zh: linked(zh),
      openRevision: openRevisionHref ? { href: openRevisionHref } : undefined,
      ...(openEditions.length > 0 ? { openEditions } : {}),
    });
  }

  for (const [id, { main, openEditions }] of resolvedPrByRfcId) {
    if (entriesById.has(id) || main.pr.status === "closed") continue;
    const { pr, ref } = main;
    entriesById.set(id, {
      id,
      number: ref.number || (id.match(/^PRFC-\d+/)?.[0] ?? id),
      title: ref.title,
      ...(ref.titleZh ? { titleZh: ref.titleZh } : {}),
      status: pr.status,
      prNumber: pr.number,
      prTitle: pr.title,
      prHref: pr.url,
      ...(openEditions.length > 0 ? { openEditions } : {}),
    });
  }

  return [...entriesById.values()].sort(
    (a, b) => a.number.localeCompare(b.number) || a.id.localeCompare(b.id),
  );
}

function inSiteHref(id: string, zh: boolean): string {
  return zh ? `/rfcs/${id}.zh` : `/rfcs/${id}`;
}

/** The 4-digit number shown in the sidebar rail (e.g. `0001` from `PRFC-0001`). */
export function shortRfcNumber(number: string): string {
  return number.replace(/^PRFC-/, "");
}

/** An RFC's title without its leading `PRFC-NNNN` prefix or `: subtitle` (for sidebar and table rows). */
export function shortRfcTitle(title: string): string {
  const withoutNumber = title.replace(/^PRFC-\d+\s*[:：—–-]?\s*/, "").trim();
  const withoutSubtitle = withoutNumber.replace(/\s*[:：]\s*.+$/, "").trim();
  return withoutSubtitle || withoutNumber || title;
}

/** The full H1 title of an RFC entry in the active locale. */
export function rfcEntryTitle(entry: RfcEntry, locale: string): string {
  return locale === "zh" ? (entry.titleZh ?? entry.title) : entry.title;
}

/** The short title of an RFC entry in the active locale (without the `PRFC-NNNN ` prefix). */
export function rfcEntryShortTitle(entry: RfcEntry, locale: string): string {
  return shortRfcTitle(rfcEntryTitle(entry, locale));
}

/** The document version for the active locale, falling back when only one language exists. */
export function rfcDocForLocale(entry: RfcEntry, locale: string): RfcDocument | undefined {
  return locale === "zh" ? (entry.zh ?? entry.en) : (entry.en ?? entry.zh);
}

/**
 * Strip the leading `# H1` title and the `[中文版]` / `[English]` language-switch link from a
 * raw RFC Markdown file: the page header renders the H1, and the site bar switches languages.
 */
export function rfcBodyMarkdown(raw: string): string {
  return raw
    .replace(/^#\s+.+\n+/, "")
    .replace(/^\[(?:中文版|English)\]\([^)\n]+\.md\)\n+/m, "")
    .trimStart();
}

/** The rfcs/ directory's raw documents, read at build time. */
const documents = import.meta.glob("../../../../rfcs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The `request-for-comments` PR records, read at build time via `virtual:penguin-rfc-prs`. */
export const rfcPrRecords = (rawPrRecords as RfcPrRecord[] | undefined) ?? [];

/** Look up a `request-for-comments` PR record by its GitHub URL. */
export function rfcPrOfUrl(url: string): RfcPrRecord | undefined {
  return rfcPrRecords.find((pr) => pr.url === url);
}

/** The index the RFC pages render: every document pair and RFC PR, sorted by number. */
export const rfcEntries = buildRfcIndex(documents, rfcPrRecords);

interface RfcTreeSpec {
  key: string;
  label?: string;
  rfcId?: string;
  children?: RfcTreeSpec[];
}

const RFC_TREE_SPEC: readonly RfcTreeSpec[] = [
  {
    key: "meta",
    label: "Meta",
    children: [{ key: "PRFC-0022-rfc-invariant", rfcId: "PRFC-0022-rfc-invariant" }],
  },
  {
    key: "modules-and-plugins",
    label: "Modules & Plugins",
    children: [
      {
        key: "PRFC-0001-module",
        rfcId: "PRFC-0001-module",
        children: [
          { key: "PRFC-0010-ui-modules", rfcId: "PRFC-0010-ui-modules" },
          { key: "PRFC-0024-cli-modules", rfcId: "PRFC-0024-cli-modules" },
          { key: "PRFC-0025-module-pass", rfcId: "PRFC-0025-module-pass" },
        ],
      },
      {
        key: "PRFC-0003-plugin",
        rfcId: "PRFC-0003-plugin",
        children: [
          { key: "PRFC-0004-plugin-scope", rfcId: "PRFC-0004-plugin-scope" },
          { key: "PRFC-0005-plugin-versioning", rfcId: "PRFC-0005-plugin-versioning" },
          { key: "PRFC-0006-plugin-distribution", rfcId: "PRFC-0006-plugin-distribution" },
          { key: "PRFC-0012-chat-bots", rfcId: "PRFC-0012-chat-bots" },
        ],
      },
    ],
  },
  {
    key: "harness",
    label: "Harness",
    children: [
      {
        key: "observability",
        label: "Observability",
        children: [{ key: "PRFC-0008-telemetry", rfcId: "PRFC-0008-telemetry" }],
      },
      {
        key: "agent",
        label: "Agent",
        children: [
          { key: "PRFC-0009-sandbox", rfcId: "PRFC-0009-sandbox" },
          { key: "PRFC-0015-agent-state", rfcId: "PRFC-0015-agent-state" },
          {
            key: "PRFC-0014-workflow",
            rfcId: "PRFC-0014-workflow",
            children: [{ key: "PRFC-0020-agent-workbench", rfcId: "PRFC-0020-agent-workbench" }],
          },
          { key: "PRFC-0017-session-surface", rfcId: "PRFC-0017-session-surface" },
          { key: "PRFC-0018-amsp", rfcId: "PRFC-0018-amsp" },
          { key: "PRFC-0019-rsi-toolkits", rfcId: "PRFC-0019-rsi-toolkits" },
          { key: "PRFC-0016-company-proposals", rfcId: "PRFC-0016-company-proposals" },
        ],
      },
      {
        key: "runtime",
        label: "Runtime",
        children: [
          { key: "PRFC-0002-hmr", rfcId: "PRFC-0002-hmr" },
          { key: "PRFC-0007-schema-migrations", rfcId: "PRFC-0007-schema-migrations" },
          { key: "PRFC-0011-single-socket", rfcId: "PRFC-0011-single-socket" },
        ],
      },
      {
        key: "distribution",
        label: "Distribution",
        children: [
          {
            key: "PRFC-0021-distros",
            rfcId: "PRFC-0021-distros",
            children: [{ key: "PRFC-0023-harness-meta", rfcId: "PRFC-0023-harness-meta" }],
          },
        ],
      },
    ],
  },
];

/** Build the hierarchical RFC tree (Meta, Modules & Plugins, Harness) from an entry list. */
export function buildRfcTree(entries: readonly RfcEntry[] = rfcEntries): RfcTreeNode[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const placed = new Set<string>();

  const buildNode = (spec: RfcTreeSpec): RfcTreeNode | null => {
    const entry = spec.rfcId ? byId.get(spec.rfcId) : undefined;
    if (spec.rfcId && !entry) return null;
    if (entry) placed.add(entry.id);
    const editionChildren: RfcTreeNode[] = (entry?.openEditions ?? []).map((editionPr) => ({
      key: `${entry!.id}:pr-${editionPr.number}`,
      editionPr,
    }));
    const specChildren = (spec.children ?? [])
      .map(buildNode)
      .filter((child): child is RfcTreeNode => child !== null);
    const children = [...editionChildren, ...specChildren];
    if (!entry && children.length === 0) return null;
    return {
      key: spec.key,
      ...(spec.label ? { label: spec.label } : {}),
      ...(entry ? { entry } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
  };

  const tree = RFC_TREE_SPEC.map(buildNode).filter((node): node is RfcTreeNode => node !== null);
  const unplaced = entries.filter((entry) => !placed.has(entry.id));
  if (unplaced.length > 0) {
    const harness = tree.find((node) => node.key === "harness");
    const extraNodes: RfcTreeNode[] = unplaced.map((entry) => {
      const editionChildren: RfcTreeNode[] = (entry.openEditions ?? []).map((editionPr) => ({
        key: `${entry.id}:pr-${editionPr.number}`,
        editionPr,
      }));
      return {
        key: entry.id,
        entry,
        ...(editionChildren.length > 0 ? { children: editionChildren } : {}),
      };
    });
    if (harness) {
      harness.children = [...(harness.children ?? []), ...extraNodes];
    } else {
      tree.push({ key: "harness", label: "Harness", children: extraNodes });
    }
  }
  return tree;
}

/** The hierarchical RFC tree rendered on the `/rfcs` index page. */
export const rfcTree = buildRfcTree(rfcEntries);

/** Every node key in `nodes` that has at least one child and can be collapsed or expanded. */
export function collapsibleRfcTreeKeys(nodes: readonly RfcTreeNode[] = rfcTree): string[] {
  const keys: string[] = [];
  const visit = (list: readonly RfcTreeNode[]) => {
    for (const node of list) {
      if (node.children && node.children.length > 0) {
        keys.push(node.key);
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return keys;
}

/** Count how many RFC entries live inside `node`'s descendants. */
export function countRfcTreeDescendantEntries(node: RfcTreeNode): number {
  let count = 0;
  for (const child of node.children ?? []) {
    if (child.entry) count += 1;
    count += countRfcTreeDescendantEntries(child);
  }
  return count;
}

function defaultStorage(): Storage | null {
  try {
    return typeof globalThis !== "undefined" && "localStorage" in globalThis
      ? globalThis.localStorage
      : null;
  } catch {
    return null;
  }
}

/** Read the persisted set of collapsed RFC tree node keys from storage. */
export function readRfcTreeCollapsed(
  validKeys: ReadonlySet<string> = new Set(collapsibleRfcTreeKeys()),
  storage: Pick<Storage, "getItem"> | null | undefined = defaultStorage(),
): Set<string> {
  try {
    const raw = storage?.getItem(RFC_TREE_COLLAPSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((item): item is string => typeof item === "string" && validKeys.has(item)),
    );
  } catch {
    return new Set();
  }
}

/** Persist the set of collapsed RFC tree node keys to storage. */
export function writeRfcTreeCollapsed(
  collapsed: Iterable<string>,
  storage: Pick<Storage, "setItem"> | null | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(RFC_TREE_COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Ignore storage access errors.
  }
}

/** Historical slug aliases for RFCs whose file slug was renamed across revisions. */
const RFC_SLUG_ALIASES: Readonly<Record<string, string>> = {
  "PRFC-0024-cli-resolution": "PRFC-0024-cli-modules",
};

/** Find an RFC entry by its route id (with or without `.zh`, supporting registered slug aliases or a unique bare `PRFC-NNNN` number). */
export function rfcEntryOf(id: string): RfcEntry | undefined {
  const baseId = id.replace(/\.zh$/, "");
  const resolvedId = RFC_SLUG_ALIASES[baseId] ?? baseId;
  const exact = rfcEntries.find((entry) => entry.id === resolvedId);
  if (exact) return exact;
  if (/^PRFC-\d+$/.test(baseId)) {
    const matches = rfcEntries.filter((entry) => entry.number === baseId);
    return matches.length === 1 ? matches[0] : undefined;
  }
  return undefined;
}

/** Read `rfcs/README.md` or `rfcs/README.zh.md` into its intro paragraph and its `## ` sections. */
export function rfcReadmeParts(locale: string): { intro: string; tail: string } {
  const file = locale === "zh" ? "README.zh.md" : "README.md";
  const raw =
    Object.entries(documents).find(
      ([path]) => path.slice(path.lastIndexOf("/") + 1) === file,
    )?.[1] ?? "";
  const body = rfcBodyMarkdown(raw);
  const firstSection = body.indexOf("\n## ");
  if (firstSection === -1) return { intro: body.trim(), tail: "" };
  return {
    intro: body.slice(0, firstSection).trim(),
    tail: body.slice(firstSection + 1).trim(),
  };
}

/** Previous / next pagination across the RFC index and every merged RFC in sidebar order. */
export function rfcPagerFor(
  activeId: string,
  locale: string,
  indexLabel: string,
): { prev?: RfcPagerItem; next?: RfcPagerItem } {
  const baseId = activeId.replace(/\.zh$/, "");
  const pages: RfcPagerItem[] = [
    { id: "index", href: "/rfcs", title: indexLabel },
    ...rfcEntries
      .filter((entry) => entry.status === "merged" && rfcDocForLocale(entry, locale))
      .map((entry) => ({
        id: entry.id,
        href: `/rfcs/${entry.id}`,
        title: rfcEntryTitle(entry, locale),
      })),
  ];
  const idx = pages.findIndex((page) => page.id === baseId);
  if (idx === -1) return {};
  return { prev: pages[idx - 1], next: pages[idx + 1] };
}

// ---------- Section-level search over the RFC index and every landed RFC ----------

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeWithSourceMap(text: string): {
  value: string;
  starts: number[];
  ends: number[];
} {
  let value = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpace: SiteSearchRange | null = null;
  const append = (ch: string, s: number, e: number) => {
    value += ch;
    for (let i = 0; i < ch.length; i += 1) {
      starts.push(s);
      ends.push(e);
    }
  };
  for (const { segment, index: s } of GRAPHEME_SEGMENTER.segment(text)) {
    const e = s + segment.length;
    for (const ch of segment.normalize("NFKC").toLowerCase()) {
      if (/\s/u.test(ch)) {
        if (value) {
          pendingSpace ??= { start: s, end: e };
          pendingSpace.end = e;
        }
        continue;
      }
      if (pendingSpace) {
        append(" ", pendingSpace.start, pendingSpace.end);
        pendingSpace = null;
      }
      append(ch, s, e);
    }
  }
  return { value, starts, ends };
}

export function findRfcSearchMatchRanges(text: string, rawQuery: string): SiteSearchRange[] {
  const terms = normalizeSearch(rawQuery).split(" ").filter(Boolean);
  if (terms.length === 0 || !text) return [];
  const { value, starts, ends } = normalizeWithSourceMap(text);
  const ranges: SiteSearchRange[] = [];
  for (const term of terms) {
    let from = 0;
    while (from < value.length) {
      const at = value.indexOf(term, from);
      if (at < 0) break;
      const start = starts[at];
      const end = ends[at + term.length - 1];
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
      from = at + Math.max(1, term.length);
    }
  }
  return ranges
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<SiteSearchRange[]>((merged, range) => {
      const prev = merged[merged.length - 1];
      if (prev && range.start <= prev.end) prev.end = Math.max(prev.end, range.end);
      else merged.push({ ...range });
      return merged;
    }, []);
}

function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|~~|__|\*)/g, "")
    .replace(/(^|[^\w])_|_([^\w]|$)/g, "$1$2")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitMarkdownSections(body: string): { heading: string; anchor: string; text: string }[] {
  const sections: { heading: string; anchor: string; lines: string[] }[] = [
    { heading: "", anchor: "", lines: [] },
  ];
  let current = sections[0]!;
  let fence: { char: string; len: number } | null = null;
  for (const line of body.split("\n")) {
    if (!fence) {
      const openFence = /^\s{0,3}(`{3,}[^`]*|~{3,}.*)$/.exec(line);
      if (openFence) {
        const seqMatch = /^(`+|~+)/.exec(openFence[1]!);
        const seq = seqMatch![1]!;
        fence = { char: seq[0]!, len: seq.length };
        continue;
      }
    } else {
      const closeFence = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (closeFence) {
        const seq = closeFence[1]!;
        if (seq[0] === fence.char && seq.length >= fence.len) {
          fence = null;
        }
      }
      continue;
    }
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (match) {
      const heading = markdownToPlain(match[2]!);
      current = { heading, anchor: slugifyHeading(heading), lines: [] };
      sections.push(current);
      continue;
    }
    if (!/^\[[^\]]+\]:\s*#/.test(line)) current.lines.push(line);
  }
  const introProse = sections[0]!.lines.filter(
    (line) => !/^\s*>/.test(line) && !/^\s*-\s+[^:\n]+:/.test(line),
  );
  const resolved = sections.map((s, idx) => ({
    heading: s.heading,
    anchor: s.anchor,
    text: markdownToPlain((idx === 0 ? introProse : s.lines).join("\n")),
  }));
  if (resolved[0] && !resolved[0].text && resolved[1]?.text) {
    resolved[0].text = resolved[1].text;
  }
  return resolved;
}

function createRfcSearchSnippet(text: string, query: string, maxLength = 140): string {
  if (text.length <= maxLength) return text;
  const { value: normalized, starts } = normalizeWithSourceMap(text);
  const terms = query.split(" ").filter(Boolean);
  let match = normalized.indexOf(query);
  if (match < 0) {
    for (const term of terms) {
      const idx = normalized.indexOf(term);
      if (idx >= 0 && (match < 0 || idx < match)) match = idx;
    }
  }
  const matchStart = match < 0 ? 0 : (starts[match] ?? 0);
  const start = Math.max(0, matchStart - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function buildRfcSearchRecords(
  locale: string,
  indexPage: { title: string; body: string },
): RfcSearchRecord[] {
  const pages = [
    { href: "/rfcs", title: indexPage.title, body: indexPage.body },
    ...rfcEntries
      .filter((entry) => entry.status === "merged" && rfcDocForLocale(entry, locale))
      .map((entry) => ({
        href: `/rfcs/${entry.id}`,
        title: rfcEntryTitle(entry, locale),
        body: rfcBodyMarkdown(rfcDocForLocale(entry, locale)!.raw),
      })),
  ];
  return pages.flatMap((page) =>
    splitMarkdownSections(page.body).map((sec) => ({
      href: page.href,
      anchor: sec.anchor,
      pageTitle: page.title,
      heading: sec.heading,
      text: sec.text,
      normalizedTitle: normalizeSearch(page.title),
      normalizedHeading: normalizeSearch(sec.heading),
      normalizedText: normalizeSearch(sec.text),
    })),
  );
}

export function searchRfcRecords(
  records: readonly RfcSearchRecord[],
  rawQuery: string,
  limit = 10,
): RfcSearchHit[] {
  const query = normalizeSearch(rawQuery);
  if (!query) return [];
  const terms = query.split(" ").filter(Boolean);
  const hits: (RfcSearchHit & { order: number })[] = [];
  records.forEach((rec, order) => {
    const combined = `${rec.normalizedTitle} ${rec.normalizedHeading} ${rec.normalizedText}`;
    if (!terms.every((t) => combined.includes(t))) return;
    const content = `${rec.normalizedHeading} ${rec.normalizedText}`;
    if (rec.heading && !terms.some((t) => content.includes(t))) return;
    let score = 0;
    const isPage = rec.heading === "";
    if (rec.normalizedTitle.includes(query)) score += isPage ? 120 : 20;
    if (rec.normalizedHeading.includes(query)) score += 100;
    if (rec.normalizedText.includes(query)) score += 45;
    for (const t of terms) {
      if (rec.normalizedTitle.includes(t)) score += isPage ? 20 : 5;
      if (rec.normalizedHeading.includes(t)) score += 25;
      if (rec.normalizedText.includes(t)) score += 8;
    }
    const snippet = createRfcSearchSnippet(rec.text, query);
    hits.push({ record: rec, score, snippet, order });
  });
  return hits
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ order: _order, ...hit }) => hit);
}
