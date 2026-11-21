/**
 * The RFC surface's chrome: the left sidebar rail (Search trigger + "RFCs" section with 4-digit
 * monospace numbers and short titles), the mobile collapsible navigation bar, the previous/next
 * pager, the section-level search dialog, and the shared 3-column layout shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  currentSearchShortcutLabel,
  SearchIcon,
  SiteSearchButton,
  SiteSearchDialog,
  SiteToc,
  useSearchHotkey,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import type {
  SiteMarkdownComponents,
  SiteSearchResult,
  TocEntry,
} from "@prismshadow/penguin-ui/site";
import {
  buildRfcSearchRecords,
  collapsibleRfcTreeKeys,
  countRfcTreeDescendantEntries,
  findRfcSearchMatchRanges,
  readRfcTreeCollapsed,
  rfcDocForLocale,
  rfcEntries,
  rfcEntryOf,
  rfcEntryShortTitle,
  rfcPagerFor,
  rfcPrOfUrl,
  rfcTree,
  searchRfcRecords,
  shortRfcNumber,
  writeRfcTreeCollapsed,
} from "../lib/rfcs";
import type { RfcEntry, RfcStatus, RfcTreeNode } from "../lib/rfcs";
import { S } from "../lib/strings";

export function RfcSidebar({
  onNavigate,
  onOpenSearch,
}: {
  onNavigate?: () => void;
  onOpenSearch?: (trigger: HTMLButtonElement) => void;
}) {
  const { pathname } = useLocation();
  const { locale } = useSiteLocale();
  const activeId = pathname
    .replace(/^\/rfcs\/?/, "")
    .replace(/\/$/, "")
    .replace(/\.zh$/, "");
  const isIndex = pathname === "/rfcs" || pathname === "/rfcs/";

  return (
    <nav aria-label={S.rfcs.indexLabel} className="site-sidebar text-sm">
      {onOpenSearch && (
        <SiteSearchButton
          label={S.rfcs.search.open}
          shortcut={currentSearchShortcutLabel()}
          onOpen={onOpenSearch}
        />
      )}
      <div className="mb-6">
        <p className="site-eyebrow mb-2">{S.rfcs.sidebarTitle}</p>
        <ul className="site-rail-list site-rail-tight">
          <li>
            <Link
              to="/rfcs"
              onClick={onNavigate}
              aria-current={isIndex ? "page" : undefined}
              className="site-rail-link py-1 pl-3"
            >
              {S.rfcs.indexLabel}
            </Link>
          </li>
          {rfcEntries
            .filter((entry) => entry.status === "merged" && rfcDocForLocale(entry, locale))
            .map((entry) => {
              const active = !isIndex && activeId === entry.id;
              return (
                <li key={entry.id}>
                  <Link
                    to={`/rfcs/${entry.id}`}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className="site-rail-link py-1 pl-3"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="shrink-0 font-mono text-xs text-gray-400 dark:text-gray-500">
                        {shortRfcNumber(entry.number)}
                      </span>
                      <span>{rfcEntryShortTitle(entry, locale)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
        </ul>
      </div>
    </nav>
  );
}

export function RfcPager({ activeId }: { activeId: string }) {
  const { locale } = useSiteLocale();
  const { prev, next } = rfcPagerFor(activeId, locale, S.rfcs.indexLabel);
  if (!prev && !next) return null;
  const stepClass =
    "group flex flex-col gap-1 rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700";

  return (
    <div className="mt-10 grid gap-3 border-t border-gray-200 pt-6 sm:grid-cols-2 dark:border-gray-800">
      {prev ? (
        <Link to={prev.href} className={stepClass}>
          <span className="text-xs text-gray-500 dark:text-gray-400">{S.rfcs.prev}</span>
          <span className="text-sm font-medium group-hover:text-brand-700 dark:group-hover:text-brand-300">
            {prev.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link to={next.href} className={`${stepClass} sm:items-end sm:text-right`}>
          <span className="text-xs text-gray-500 dark:text-gray-400">{S.rfcs.next}</span>
          <span className="text-sm font-medium group-hover:text-brand-700 dark:group-hover:text-brand-300">
            {next.title}
          </span>
        </Link>
      )}
    </div>
  );
}

function RfcPrStatusIcon({
  status,
  className = "inline-block shrink-0 translate-y-[3px]",
}: {
  status: RfcStatus;
  className?: string;
}) {
  const color =
    status === "merged"
      ? "text-purple-600 dark:text-purple-400"
      : status === "open"
        ? "text-emerald-600 dark:text-emerald-400"
        : status === "closed"
          ? "text-rose-600 dark:text-rose-400"
          : "text-gray-500 dark:text-gray-400";
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="currentColor"
      aria-label={status}
      className={`${className} ${color}`}
    >
      {status === "merged" ? (
        <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z" />
      ) : status === "open" ? (
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
      ) : status === "closed" ? (
        <path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.25.25 0 0 1 .25.25v3.878a2.251 2.251 0 1 1-1.5 0V6.75a.25.25 0 0 1 .25-.25h1Zm-10.25-3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm1.28-10.53a.75.75 0 0 1 0 1.06L13.06 3.5l.97.97a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L12 4.56l-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l.97.97.97-.97a.75.75 0 0 1 1.06 0Z" />
      ) : (
        <path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z" />
      )}
    </svg>
  );
}

interface FlatTreeRow {
  node: RfcTreeNode;
  depth: number;
  isFirstRoot: boolean;
  /** For each ancestor depth `0 .. depth - 1`, whether that ancestor's vertical rail continues below this row. */
  ancestorContinues: readonly boolean[];
  /** Whether this node's own vertical rail continues downward into its visible children. */
  selfContinues: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  descendantCount: number;
  hiddenChildCount: number;
}

function flattenRfcTree(
  roots: readonly RfcTreeNode[],
  collapsed: ReadonlySet<string>,
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  const visit = (
    node: RfcTreeNode,
    depth: number,
    isFirstRoot: boolean,
    ancestorContinues: readonly boolean[],
  ) => {
    const children = node.children ?? [];
    const hasChildren = children.length > 0;
    const isCollapsed = hasChildren && collapsed.has(node.key);
    const visibleChildren = isCollapsed ? [] : children;
    const selfContinues = visibleChildren.length > 0;
    const descendantCount = hasChildren ? countRfcTreeDescendantEntries(node) : 0;
    const hiddenChildCount = children.length;

    rows.push({
      node,
      depth,
      isFirstRoot,
      ancestorContinues,
      selfContinues,
      hasChildren,
      isCollapsed,
      descendantCount,
      hiddenChildCount,
    });

    visibleChildren.forEach((child, idx) => {
      const childIsLast = idx === visibleChildren.length - 1;
      visit(child, depth + 1, false, [...ancestorContinues, !childIsLast]);
    });
  };
  roots.forEach((root, idx) => {
    visit(root, 0, idx === 0, []);
  });
  return rows;
}

function RfcPrBadge({
  href,
  number,
  status,
}: {
  href: string;
  number: number;
  status: RfcStatus;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs tabular-nums text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
    >
      <RfcPrStatusIcon status={status} className="shrink-0" />
      <span>#{number}</span>
    </a>
  );
}

function nodeAccessibleName(node: RfcTreeNode, locale: string): string {
  if (node.entry) {
    return `${node.entry.number} ${rfcEntryShortTitle(node.entry, locale)}`;
  }
  if (node.editionPr) {
    return `#${node.editionPr.number} ${node.editionPr.title}`;
  }
  return node.label ?? node.key;
}

function RfcEntryLink({
  entry,
  locale,
}: {
  entry: RfcEntry;
  locale: string;
}) {
  const doc = rfcDocForLocale(entry, locale);
  const shortTitle = rfcEntryShortTitle(entry, locale);
  if (entry.status === "merged" && doc) {
    return (
      <Link
        to={`/rfcs/${entry.id}`}
        className="group inline-flex min-w-0 items-baseline gap-2 text-sm"
      >
        <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500 group-hover:text-brand-700 dark:text-gray-400 dark:group-hover:text-brand-300">
          {entry.number}
        </span>
        <span className="truncate font-medium text-gray-900 group-hover:text-brand-700 dark:text-gray-100 dark:group-hover:text-brand-300">
          {shortTitle}
        </span>
      </Link>
    );
  }
  if (entry.prHref) {
    return (
      <a
        href={entry.prHref}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex min-w-0 items-baseline gap-2 text-sm"
      >
        <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500 group-hover:text-brand-700 dark:text-gray-400 dark:group-hover:text-brand-300">
          {entry.number}
        </span>
        <span className="truncate font-medium text-gray-700 group-hover:text-brand-700 dark:text-gray-300 dark:group-hover:text-brand-300">
          {shortTitle}
        </span>
      </a>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-baseline gap-2 text-sm">
      <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
        {entry.number}
      </span>
      <span className="truncate font-medium text-gray-700 dark:text-gray-300">{shortTitle}</span>
    </span>
  );
}

function GraphTreeView({
  rows,
  locale,
  onToggle,
}: {
  rows: readonly FlatTreeRow[];
  locale: string;
  onToggle: (key: string) => void;
}) {
  const LANE = 22;
  const CY = 15;
  const xOf = (d: number) => d * LANE + 11;

  return (
    <div role="tree" aria-label={S.rfcs.sectionAll} className="select-none">
      {rows.map((row) => {
        const {
          node,
          depth,
          isFirstRoot,
          ancestorContinues,
          selfContinues,
          hasChildren,
          isCollapsed,
          descendantCount,
          hiddenChildCount,
        } = row;
        const cx = xOf(depth);
        const px = depth > 0 ? xOf(depth - 1) : cx;
        const railWidth = depth * LANE + 24;
        const entry = node.entry;
        const editionPr = node.editionPr;
        const name = nodeAccessibleName(node, locale);

        const nodeStrokeClass = !entry
          ? depth === 0
            ? "stroke-gray-700 dark:stroke-gray-200"
            : "stroke-gray-500 dark:stroke-gray-400"
          : entry.status === "merged"
            ? "stroke-purple-600 dark:stroke-purple-400"
            : entry.status === "open"
              ? "stroke-emerald-600 dark:stroke-emerald-400"
              : "stroke-gray-400 dark:stroke-gray-500";

        const nodeGlyphColorClass = !entry
          ? depth === 0
            ? "text-gray-700 dark:text-gray-200"
            : "text-gray-500 dark:text-gray-400"
          : entry.status === "merged"
            ? "text-purple-600 dark:text-purple-400"
            : entry.status === "open"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-gray-500 dark:text-gray-400";

        return (
          <div
            key={node.key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            className={`flex min-h-[30px] items-stretch ${depth === 0 && !isFirstRoot ? "mt-2" : ""}`}
          >
            <div className="relative shrink-0 self-stretch" style={{ width: `${railWidth}px` }}>
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-gray-300 dark:text-gray-700"
              >
                {ancestorContinues.map((continues, d) =>
                  continues ? (
                    <line
                      key={d}
                      x1={xOf(d)}
                      y1={0}
                      x2={xOf(d)}
                      y2="100%"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    />
                  ) : null,
                )}
                {depth > 0 && (
                  <path
                    d={`M ${px} 0 L ${px} ${CY - 6} Q ${px} ${CY} ${px + 6} ${CY} L ${cx} ${CY}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />
                )}
                {selfContinues && (
                  <line
                    x1={cx}
                    y1={CY}
                    x2={cx}
                    y2="100%"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  />
                )}
                {hasChildren ? (
                  <>
                    <circle
                      cx={cx}
                      cy={CY}
                      r={6}
                      className={`fill-white dark:fill-gray-950 ${nodeStrokeClass}`}
                      strokeWidth={1.5}
                    />
                    <line
                      x1={cx - 2.5}
                      y1={CY}
                      x2={cx + 2.5}
                      y2={CY}
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      className={nodeGlyphColorClass}
                    />
                    {isCollapsed && (
                      <line
                        x1={cx}
                        y1={CY - 2.5}
                        x2={cx}
                        y2={CY + 2.5}
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        className={nodeGlyphColorClass}
                      />
                    )}
                  </>
                ) : editionPr ? (
                  <circle
                    cx={cx}
                    cy={CY}
                    r={3.5}
                    className={
                      editionPr.status === "open"
                        ? "fill-white stroke-emerald-600 dark:fill-gray-950 dark:stroke-emerald-400"
                        : "fill-white stroke-gray-400 dark:fill-gray-950 dark:stroke-gray-500"
                    }
                    strokeWidth={1.5}
                  />
                ) : entry?.status === "merged" ? (
                  <circle
                    cx={cx}
                    cy={CY}
                    r={4.25}
                    className="fill-purple-600 stroke-white dark:fill-purple-400 dark:stroke-gray-950"
                    strokeWidth={1.5}
                  />
                ) : entry?.status === "open" ? (
                  <circle
                    cx={cx}
                    cy={CY}
                    r={4.25}
                    className="fill-emerald-600 stroke-white dark:fill-emerald-400 dark:stroke-gray-950"
                    strokeWidth={1.5}
                  />
                ) : (
                  <circle
                    cx={cx}
                    cy={CY}
                    r={3.75}
                    className="fill-white stroke-gray-400 dark:fill-gray-950 dark:stroke-gray-500"
                    strokeWidth={1.75}
                  />
                )}
              </svg>
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => onToggle(node.key)}
                  aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                  style={{ left: `${cx - 10}px`, top: `${CY - 10}px` }}
                  className="absolute h-5 w-5 cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                />
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 select-text">
              {editionPr ? (
                <a
                  href={editionPr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 -ml-1.5 text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/60"
                >
                  <RfcPrStatusIcon status={editionPr.status} className="shrink-0" />
                  <span className="shrink-0 font-mono tabular-nums text-gray-600 group-hover:text-brand-700 dark:text-gray-400 dark:group-hover:text-brand-300">
                    #{editionPr.number}
                  </span>
                  <span className="truncate text-gray-600 group-hover:text-brand-700 dark:text-gray-400 dark:group-hover:text-brand-300">
                    {editionPr.title}
                  </span>
                </a>
              ) : !entry ? (
                <button
                  type="button"
                  onClick={() => onToggle(node.key)}
                  aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                  className="inline-flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 -ml-1.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/60"
                >
                  <span
                    className={
                      depth === 0
                        ? "text-sm font-semibold text-gray-900 dark:text-gray-100"
                        : "text-sm font-medium text-gray-700 dark:text-gray-300"
                    }
                  >
                    {node.label}
                  </span>
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] leading-none tabular-nums text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {descendantCount}
                  </span>
                </button>
              ) : (
                <>
                  <RfcEntryLink entry={entry} locale={locale} />
                  {entry.prNumber && entry.prHref && (
                    <RfcPrBadge href={entry.prHref} number={entry.prNumber} status={entry.status} />
                  )}
                  {hasChildren && isCollapsed && (
                    <button
                      type="button"
                      onClick={() => onToggle(node.key)}
                      aria-label={S.rfcs.expandNode(name)}
                      className="cursor-pointer rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] leading-none tabular-nums text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                    >
                      +{hiddenChildCount}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Hierarchical Graph tree view of all RFCs with persistent expand/collapse state. */
export function RfcTreeView({ locale, headingId }: { locale: string; headingId?: string }) {
  const collapsibleKeys = useMemo(() => collapsibleRfcTreeKeys(rfcTree), []);
  const validKeysSet = useMemo(() => new Set(collapsibleKeys), [collapsibleKeys]);
  const [collapsed, setCollapsedState] = useState<Set<string>>(() =>
    readRfcTreeCollapsed(validKeysSet),
  );

  const toggleNode = useCallback((key: string) => {
    setCollapsedState((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeRfcTreeCollapsed(next);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const next = new Set<string>();
    setCollapsedState(next);
    writeRfcTreeCollapsed(next);
  }, []);

  const collapseAll = useCallback(() => {
    const next = new Set(collapsibleKeys);
    setCollapsedState(next);
    writeRfcTreeCollapsed(next);
  }, [collapsibleKeys]);

  const rows = useMemo(() => flattenRfcTree(rfcTree, collapsed), [collapsed]);
  const allExpanded = collapsed.size === 0;
  const allCollapsed = collapsibleKeys.length > 0 && collapsed.size >= collapsibleKeys.length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id={headingId}
          className="scroll-mt-24 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100"
        >
          {S.rfcs.sectionAll}
        </h2>
        <div className="inline-flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={expandAll}
            disabled={allExpanded}
            className="cursor-pointer text-gray-500 transition-colors hover:text-gray-900 disabled:cursor-default disabled:opacity-40 dark:text-gray-400 dark:hover:text-gray-100"
          >
            {S.rfcs.expandAll}
          </button>
          <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">
            ·
          </span>
          <button
            type="button"
            onClick={collapseAll}
            disabled={allCollapsed}
            className="cursor-pointer text-gray-500 transition-colors hover:text-gray-900 disabled:cursor-default disabled:opacity-40 dark:text-gray-400 dark:hover:text-gray-100"
          >
            {S.rfcs.collapseAll}
          </button>
        </div>
      </div>

      <GraphTreeView rows={rows} locale={locale} onToggle={toggleNode} />
    </div>
  );
}

/** Markdown link adapter for both the RFC index and individual RFC pages. */
export function RfcMdLink({ href = "", children }: { href?: string; children?: ReactNode }) {
  if (href.startsWith("#")) {
    return <a href={href}>{children}</a>;
  }
  if (href.startsWith("/")) {
    return <Link to={href}>{children}</Link>;
  }
  if (/^(?:\.\/|\.\.\/)?README(?:\.zh)?\.md(#.*)?$/i.test(href)) {
    const hash = href.includes("#") ? href.slice(href.indexOf("#")) : "";
    return <Link to={`/rfcs${hash}`}>{children}</Link>;
  }
  const rfcMatch = /^(?:\.\/)?(PRFC-\d+-[A-Za-z0-9_-]+)(?:\.zh)?\.md(#.*)?$/.exec(href);
  if (rfcMatch) {
    const targetId = rfcMatch[1]!;
    const hash = rfcMatch[2] ?? "";
    const entry = rfcEntryOf(targetId);
    if (entry && entry.status !== "merged") {
      const externalHref = entry.prHref ?? entry.en?.href;
      if (externalHref) {
        return (
          <a href={externalHref} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
    }
    return <Link to={`/rfcs/${targetId}${hash}`}>{children}</Link>;
  }
  if (/^https?:\/\//.test(href)) {
    const pr = rfcPrOfUrl(href);
    const text = typeof children === "string" ? children : "";
    if (pr && (text === `#${pr.number}` || text.startsWith(`#${pr.number} `))) {
      return (
        <span className="inline-flex items-baseline gap-1">
          <RfcPrStatusIcon status={pr.status} />
          <a href={href} target="_blank" rel="noreferrer" className="min-w-0">
            {children}
          </a>
        </span>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return <a href={href}>{children}</a>;
}

/** Module-level, so react-markdown keeps one element type across renders. */
export const RFC_MD_COMPONENTS: SiteMarkdownComponents = {
  a: ({ href, children }) => <RfcMdLink href={href}>{children}</RfcMdLink>,
};

interface RfcDialogResult extends SiteSearchResult {
  target: string;
}

export function RfcShell({
  activeId,
  mobileLabel,
  editHref,
  indexSearchBody,
  toc,
  activeTocId,
  onPinToc,
  children,
}: {
  activeId: string;
  mobileLabel: string;
  editHref: string;
  indexSearchBody: string;
  toc: readonly TocEntry[];
  activeTocId: string;
  onPinToc: (id: string) => void;
  children: ReactNode;
}) {
  const { locale } = useSiteLocale();
  const { pathname, hash, key } = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const mobileDetailsRef = useRef<HTMLDetailsElement | null>(null);

  const openSearch = useCallback((trigger?: HTMLElement) => {
    const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchReturnFocusRef.current = trigger ?? activeEl;
    if (mobileDetailsRef.current) mobileDetailsRef.current.open = false;
    setSearchOpen(true);
  }, []);

  const openSearchByKey = useCallback(() => openSearch(), [openSearch]);
  useSearchHotkey(searchOpen, openSearchByKey);

  useEffect(() => {
    if (mobileDetailsRef.current) mobileDetailsRef.current.open = false;
  }, [pathname, hash, key]);

  const records = useMemo(
    () => buildRfcSearchRecords(locale, { title: S.rfcs.indexLabel, body: indexSearchBody }),
    [locale, indexSearchBody],
  );

  const search = useCallback(
    (query: string): RfcDialogResult[] =>
      searchRfcRecords(records, query).map(({ record, snippet }, idx) => ({
        key: `${record.href}:${record.anchor || "page"}:${idx}`,
        title: record.heading || record.pageTitle,
        context: record.heading ? record.pageTitle : undefined,
        snippet: snippet || undefined,
        target: record.anchor ? `${record.href}#${record.anchor}` : record.href,
      })),
    [records],
  );

  const showToc = toc.length >= 2;

  return (
    <div className="mx-auto w-full max-w-7xl lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-gray-200 lg:block dark:border-gray-800">
        <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-6 py-8">
          <RfcSidebar onOpenSearch={openSearch} />
        </div>
      </aside>
      <div className="min-w-0">
        <div
          className={`anim-rise px-4 py-10 sm:px-6 lg:px-10 ${
            showToc ? "xl:grid xl:grid-cols-[minmax(0,1fr)_14rem] xl:gap-10" : ""
          }`}
        >
          <div className="min-w-0">
            <div className="mb-6 flex items-start gap-2 lg:hidden">
              <details
                ref={mobileDetailsRef}
                className="min-w-0 flex-1 rounded-lg border border-gray-200 text-sm dark:border-gray-800"
              >
                <summary className="cursor-pointer px-3 py-1.5 font-medium">
                  {S.rfcs.sidebarTitle}: {mobileLabel}
                </summary>
                <div className="border-t border-gray-200 px-3 py-2 dark:border-gray-800">
                  <RfcSidebar
                    onNavigate={() => {
                      if (mobileDetailsRef.current) mobileDetailsRef.current.open = false;
                    }}
                  />
                </div>
              </details>
              <button
                type="button"
                onClick={(event) => openSearch(event.currentTarget)}
                aria-label={S.rfcs.search.open}
                className="site-search-trigger inline-flex h-9 w-9 shrink-0 items-center justify-center"
              >
                <SearchIcon className="h-4 w-4" />
              </button>
            </div>

            <article className="mx-auto w-full max-w-3xl xl:mx-0">
              {children}
              <RfcPager activeId={activeId} />
              <p className="mt-6 flex flex-wrap gap-x-4 text-xs text-gray-400 dark:text-gray-500">
                <a
                  href={editHref}
                  className="transition-colors hover:text-gray-700 dark:hover:text-gray-300"
                  target="_blank"
                  rel="noreferrer"
                >
                  {S.rfcs.editOnGithub}
                </a>
              </p>
            </article>
          </div>
          {showToc && (
            <SiteToc label={S.rfcs.toc} entries={toc} activeId={activeTocId} onNavigate={onPinToc} />
          )}
        </div>
      </div>
      <SiteSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        returnFocusRef={searchReturnFocusRef}
        search={search}
        highlight={findRfcSearchMatchRanges}
        onSelect={(result) => navigate(result.target)}
        labels={S.rfcs.search}
      />
    </div>
  );
}
