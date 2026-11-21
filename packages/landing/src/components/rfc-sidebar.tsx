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
  readRfcTreeStyle,
  RFC_TREE_STYLES,
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
  writeRfcTreeStyle,
} from "../lib/rfcs";
import type { RfcEntry, RfcStatus, RfcTreeNode, RfcTreeStyle } from "../lib/rfcs";
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
  continuingTracks: readonly boolean[];
  parentContinues: boolean;
  selfContinues: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  descendantCount: number;
  asciiPrefix: string;
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
    rootIsLast: boolean,
    continuingTracks: readonly boolean[],
    parentContinues: boolean,
    asciiAncestors: readonly boolean[],
    isLastSibling: boolean,
  ) => {
    const children = node.children ?? [];
    const hasChildren = children.length > 0;
    const isCollapsed = hasChildren && collapsed.has(node.key);
    const visibleChildren = isCollapsed ? [] : children;
    const selfContinues = visibleChildren.length > 0 || (depth === 0 && !rootIsLast);
    const descendantCount = hasChildren ? countRfcTreeDescendantEntries(node) : 0;
    const asciiPrefix =
      depth === 0
        ? ""
        : `${asciiAncestors.map((c) => (c ? "│   " : "    ")).join("")}${
            isLastSibling ? "└── " : "├── "
          }`;

    rows.push({
      node,
      depth,
      isFirstRoot,
      continuingTracks,
      parentContinues,
      selfContinues,
      hasChildren,
      isCollapsed,
      descendantCount,
      asciiPrefix,
    });

    visibleChildren.forEach((child, idx) => {
      const childIsLast = idx === visibleChildren.length - 1;
      const trackContinues = !childIsLast || (depth === 0 && !rootIsLast);
      const nextContinuing = depth === 0 ? [] : [...continuingTracks, parentContinues];
      const nextAscii = depth === 0 ? [] : [...asciiAncestors, !isLastSibling];
      visit(
        child,
        depth + 1,
        false,
        rootIsLast,
        nextContinuing,
        trackContinues,
        nextAscii,
        childIsLast,
      );
    });
  };
  roots.forEach((root, idx) => {
    const isLast = idx === roots.length - 1;
    visit(root, 0, idx === 0, isLast, [], false, [], isLast);
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
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs tabular-nums text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
    >
      <RfcPrStatusIcon status={status} className="shrink-0" />
      <span>#{number}</span>
    </a>
  );
}

function RfcChevronIcon({
  expanded,
  className = "",
}: {
  expanded: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${expanded ? "rotate-90" : ""} ${className}`}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function RfcStatusDot({ status }: { status: RfcStatus }) {
  return (
    <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true" className="shrink-0">
      {status === "merged" ? (
        <circle cx="5" cy="5" r="3.5" className="fill-purple-600 dark:fill-purple-400" />
      ) : status === "open" ? (
        <circle cx="5" cy="5" r="3.5" className="fill-emerald-600 dark:fill-emerald-400" />
      ) : (
        <circle
          cx="5"
          cy="5"
          r="3"
          strokeWidth="1.5"
          className="fill-none stroke-gray-400 dark:stroke-gray-500"
        />
      )}
    </svg>
  );
}

function nodeAccessibleName(node: RfcTreeNode, locale: string): string {
  if (node.entry) {
    return `${node.entry.number} ${rfcEntryShortTitle(node.entry, locale)}`;
  }
  return node.label ?? node.key;
}

function RfcEntryLink({
  entry,
  locale,
  monoTitle = false,
}: {
  entry: RfcEntry;
  locale: string;
  monoTitle?: boolean;
}) {
  const doc = rfcDocForLocale(entry, locale);
  const shortTitle = rfcEntryShortTitle(entry, locale);
  const titleFont = monoTitle ? "font-mono text-xs" : "text-sm";
  if (entry.status === "merged" && doc) {
    return (
      <Link
        to={`/rfcs/${entry.id}`}
        className={`group inline-flex min-w-0 items-baseline gap-2 ${titleFont}`}
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
        className={`group inline-flex min-w-0 items-baseline gap-2 ${titleFont}`}
      >
        <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500 group-hover:text-brand-700 dark:text-gray-400 dark:group-hover:text-brand-300">
          {entry.number}
        </span>
        <span className="truncate font-medium text-gray-800 group-hover:text-brand-700 dark:text-gray-200 dark:group-hover:text-brand-300">
          {shortTitle}
        </span>
      </a>
    );
  }
  return (
    <span className={`inline-flex min-w-0 items-baseline gap-2 ${titleFont}`}>
      <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
        {entry.number}
      </span>
      <span className="truncate font-medium text-gray-800 dark:text-gray-200">{shortTitle}</span>
    </span>
  );
}

function RfcEntryBadges({ entry }: { entry: RfcEntry }) {
  const openRevPr = entry.openRevision ? rfcPrOfUrl(entry.openRevision.href) : undefined;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {entry.prNumber && entry.prHref && (
        <RfcPrBadge href={entry.prHref} number={entry.prNumber} status={entry.status} />
      )}
      {openRevPr && openRevPr.number !== entry.prNumber && (
        <RfcPrBadge href={openRevPr.url} number={openRevPr.number} status={openRevPr.status} />
      )}
    </span>
  );
}

function OutlineTreeBranch({
  nodes,
  locale,
  depth,
  collapsed,
  onToggle,
}: {
  nodes: readonly RfcTreeNode[];
  locale: string;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <ul
      role={depth === 0 ? "tree" : "group"}
      aria-label={depth === 0 ? S.rfcs.sectionAll : undefined}
      className={
        depth === 0
          ? "space-y-1"
          : "mt-0.5 ml-3.5 space-y-0.5 border-l border-gray-200/90 pl-3 dark:border-gray-800"
      }
    >
      {nodes.map((node) => {
        const children = node.children ?? [];
        const hasChildren = children.length > 0;
        const isCollapsed = hasChildren && collapsed.has(node.key);
        const descendantCount = hasChildren ? countRfcTreeDescendantEntries(node) : 0;
        const entry = node.entry;
        const name = nodeAccessibleName(node, locale);

        return (
          <li
            key={node.key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
          >
            {!entry ? (
              <button
                type="button"
                onClick={() => onToggle(node.key)}
                aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-100/70 dark:hover:bg-gray-900/70"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-gray-400 dark:text-gray-500">
                    <RfcChevronIcon expanded={!isCollapsed} />
                  </span>
                  <span
                    className={
                      depth === 0
                        ? "text-sm font-semibold text-gray-900 dark:text-gray-100"
                        : "text-sm font-medium text-gray-700 dark:text-gray-300"
                    }
                  >
                    {node.label}
                  </span>
                </span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-xs tabular-nums text-gray-500 dark:bg-gray-800/80 dark:text-gray-400">
                  {descendantCount}
                </span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-2 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/50">
                <div className="flex min-w-0 items-center gap-2">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => onToggle(node.key)}
                      aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      <RfcChevronIcon expanded={!isCollapsed} />
                    </button>
                  ) : (
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                      <RfcStatusDot status={entry.status} />
                    </span>
                  )}
                  <RfcEntryLink entry={entry} locale={locale} />
                  {hasChildren && isCollapsed && (
                    <button
                      type="button"
                      onClick={() => onToggle(node.key)}
                      aria-label={S.rfcs.expandNode(name)}
                      className="rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-xs tabular-nums text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                    >
                      +{descendantCount}
                    </button>
                  )}
                </div>
                <RfcEntryBadges entry={entry} />
              </div>
            )}

            {hasChildren && !isCollapsed && (
              <OutlineTreeBranch
                nodes={children}
                locale={locale}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CardTreeSublist({
  nodes,
  locale,
  depth,
  collapsed,
  onToggle,
}: {
  nodes: readonly RfcTreeNode[];
  locale: string;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className={depth > 1 ? "mt-1 ml-5 space-y-1 border-l border-gray-200 pl-3 dark:border-gray-800" : "space-y-1.5"}>
      {nodes.map((node) => {
        const children = node.children ?? [];
        const hasChildren = children.length > 0;
        const isCollapsed = hasChildren && collapsed.has(node.key);
        const descendantCount = hasChildren ? countRfcTreeDescendantEntries(node) : 0;
        const entry = node.entry;
        const name = nodeAccessibleName(node, locale);

        if (!entry) {
          return (
            <div
              key={node.key}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={hasChildren ? !isCollapsed : undefined}
              className="rounded-lg border border-gray-200/70 bg-gray-50/40 px-3 py-2 dark:border-gray-800/70 dark:bg-gray-900/25"
            >
              <button
                type="button"
                onClick={() => onToggle(node.key)}
                aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="flex items-center gap-2">
                  <RfcChevronIcon
                    expanded={!isCollapsed}
                    className="text-gray-400 dark:text-gray-500"
                  />
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {node.label}
                  </span>
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-xs tabular-nums text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {descendantCount}
                </span>
              </button>
              {hasChildren && !isCollapsed && (
                <div className="mt-2 border-t border-gray-200/60 pt-1.5 dark:border-gray-800/60">
                  <CardTreeSublist
                    nodes={children}
                    locale={locale}
                    depth={depth + 1}
                    collapsed={collapsed}
                    onToggle={onToggle}
                  />
                </div>
              )}
            </div>
          );
        }

        return (
          <div
            key={node.key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-1 transition-colors hover:bg-gray-100/60 dark:hover:bg-gray-800/40">
              <div className="flex min-w-0 items-center gap-2">
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => onToggle(node.key)}
                    aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  >
                    <RfcChevronIcon expanded={!isCollapsed} />
                  </button>
                ) : (
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                    <RfcStatusDot status={entry.status} />
                  </span>
                )}
                <RfcEntryLink entry={entry} locale={locale} />
                {hasChildren && isCollapsed && (
                  <button
                    type="button"
                    onClick={() => onToggle(node.key)}
                    aria-label={S.rfcs.expandNode(name)}
                    className="rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-xs tabular-nums text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                  >
                    +{descendantCount}
                  </button>
                )}
              </div>
              <RfcEntryBadges entry={entry} />
            </div>
            {hasChildren && !isCollapsed && (
              <CardTreeSublist
                nodes={children}
                locale={locale}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CardsTreeView({
  locale,
  collapsed,
  onToggle,
}: {
  locale: string;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div role="tree" aria-label={S.rfcs.sectionAll} className="space-y-3">
      {rfcTree.map((root) => {
        const children = root.children ?? [];
        const hasChildren = children.length > 0;
        const isCollapsed = hasChildren && collapsed.has(root.key);
        const descendantCount = countRfcTreeDescendantEntries(root);
        const name = nodeAccessibleName(root, locale);

        return (
          <div
            key={root.key}
            role="treeitem"
            aria-level={1}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950/60"
          >
            <button
              type="button"
              onClick={() => onToggle(root.key)}
              aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
              className={`flex w-full items-center justify-between gap-3 bg-gray-50/70 px-4 py-2.5 text-left transition-colors hover:bg-gray-100/70 dark:bg-gray-900/50 dark:hover:bg-gray-900 ${
                isCollapsed
                  ? "rounded-xl"
                  : "rounded-t-xl border-b border-gray-200/80 dark:border-gray-800/80"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <RfcChevronIcon
                  expanded={!isCollapsed}
                  className="text-gray-400 dark:text-gray-500"
                />
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {root.label}
                </span>
              </span>
              <span className="rounded-full bg-white px-2.5 py-0.5 font-mono text-xs tabular-nums text-gray-600 shadow-none dark:bg-gray-800 dark:text-gray-400">
                {descendantCount}
              </span>
            </button>
            {hasChildren && !isCollapsed && (
              <div className="px-3 py-2.5 sm:px-4">
                <CardTreeSublist
                  nodes={children}
                  locale={locale}
                  depth={1}
                  collapsed={collapsed}
                  onToggle={onToggle}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TerminalTreeView({
  rows,
  locale,
  onToggle,
}: {
  rows: readonly FlatTreeRow[];
  locale: string;
  onToggle: (key: string) => void;
}) {
  return (
    <div
      role="tree"
      aria-label={S.rfcs.sectionAll}
      className="overflow-x-auto rounded-xl border border-gray-200 bg-gray-50/70 px-3.5 py-3 font-mono text-xs dark:border-gray-800 dark:bg-gray-900/50"
    >
      {rows.map((row) => {
        const { node, depth, hasChildren, isCollapsed, descendantCount, asciiPrefix } = row;
        const entry = node.entry;
        const name = nodeAccessibleName(node, locale);

        return (
          <div
            key={node.key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            className="flex min-h-7 items-center justify-between gap-3 rounded px-1.5 py-0.5 transition-colors hover:bg-gray-200/50 dark:hover:bg-gray-800/50"
          >
            <div className="flex min-w-0 items-center">
              {asciiPrefix && (
                <span className="select-none whitespace-pre text-gray-400 dark:text-gray-600">
                  {asciiPrefix}
                </span>
              )}
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => onToggle(node.key)}
                  aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                  className="mr-1.5 inline-flex shrink-0 items-center rounded px-1 py-0.5 font-mono text-xs text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                >
                  {isCollapsed ? "[+]" : "[-]"}
                </button>
              )}
              {!entry ? (
                <button
                  type="button"
                  onClick={() => onToggle(node.key)}
                  className={`text-left ${
                    depth === 0
                      ? "font-semibold text-gray-900 dark:text-gray-100"
                      : "font-medium text-gray-700 dark:text-gray-300"
                  }`}
                >
                  <span>{node.label}/</span>
                  <span className="ml-2 tabular-nums text-gray-400 dark:text-gray-500">
                    ({descendantCount})
                  </span>
                </button>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <RfcEntryLink entry={entry} locale={locale} monoTitle />
                  {hasChildren && isCollapsed && (
                    <button
                      type="button"
                      onClick={() => onToggle(node.key)}
                      aria-label={S.rfcs.expandNode(name)}
                      className="rounded bg-gray-200/70 px-1.5 py-0.5 font-mono text-xs tabular-nums text-gray-600 hover:bg-gray-300/70 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                    >
                      +{descendantCount}
                    </button>
                  )}
                </div>
              )}
            </div>
            {entry && <RfcEntryBadges entry={entry} />}
          </div>
        );
      })}
    </div>
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
  const CY = 16;
  const xOf = (d: number) => d * LANE + 10;

  return (
    <div
      role="tree"
      aria-label={S.rfcs.sectionAll}
      className="rounded-xl border border-gray-200/80 bg-gray-50/40 px-4 py-3 dark:border-gray-800/80 dark:bg-gray-900/30"
    >
      {rows.map((row) => {
        const {
          node,
          depth,
          isFirstRoot,
          continuingTracks,
          parentContinues,
          selfContinues,
          hasChildren,
          isCollapsed,
          descendantCount,
        } = row;
        const cx = xOf(depth);
        const px = depth > 0 ? xOf(depth - 1) : cx;
        const railWidth = (depth + 1) * LANE + 6;
        const entry = node.entry;
        const name = nodeAccessibleName(node, locale);

        return (
          <div
            key={node.key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            className="flex min-h-8 items-stretch"
          >
            <div className="relative shrink-0 self-stretch" style={{ width: `${railWidth}px` }}>
              <svg
                aria-hidden="true"
                className="absolute inset-0 h-full w-full overflow-visible text-gray-300 dark:text-gray-700"
              >
                {depth === 0 && !isFirstRoot && (
                  <line
                    x1={cx}
                    y1={0}
                    x2={cx}
                    y2={CY}
                    stroke="currentColor"
                    strokeWidth={1.75}
                  />
                )}
                {continuingTracks.map((continues, d) =>
                  continues ? (
                    <line
                      key={d}
                      x1={xOf(d)}
                      y1={0}
                      x2={xOf(d)}
                      y2="100%"
                      stroke="currentColor"
                      strokeWidth={1.75}
                    />
                  ) : null,
                )}
                {depth > 0 && parentContinues && (
                  <line
                    x1={px}
                    y1={0}
                    x2={px}
                    y2="100%"
                    stroke="currentColor"
                    strokeWidth={1.75}
                  />
                )}
                {depth > 0 && (
                  <path
                    d={`M ${px} 0 L ${px} ${CY - 5} Q ${px} ${CY} ${px + 5} ${CY} L ${cx} ${CY}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.75}
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
                    strokeWidth={1.75}
                  />
                )}
                {!entry ? (
                  depth === 0 ? (
                    <>
                      <circle
                        cx={cx}
                        cy={CY}
                        r={5}
                        className="fill-white stroke-gray-800 dark:fill-gray-950 dark:stroke-gray-200"
                        strokeWidth={2}
                      />
                      <circle
                        cx={cx}
                        cy={CY}
                        r={2}
                        className="fill-gray-800 dark:fill-gray-200"
                      />
                    </>
                  ) : (
                    <circle
                      cx={cx}
                      cy={CY}
                      r={4}
                      className="fill-white stroke-gray-500 dark:fill-gray-950 dark:stroke-gray-400"
                      strokeWidth={1.75}
                    />
                  )
                ) : entry.status === "merged" ? (
                  <circle
                    cx={cx}
                    cy={CY}
                    r={4.5}
                    className="fill-purple-600 stroke-white dark:fill-purple-400 dark:stroke-gray-950"
                    strokeWidth={1.5}
                  />
                ) : entry.status === "open" ? (
                  <circle
                    cx={cx}
                    cy={CY}
                    r={4.5}
                    className="fill-emerald-600 stroke-white dark:fill-emerald-400 dark:stroke-gray-950"
                    strokeWidth={1.5}
                  />
                ) : (
                  <circle
                    cx={cx}
                    cy={CY}
                    r={4}
                    className="fill-white stroke-gray-400 dark:fill-gray-950 dark:stroke-gray-500"
                    strokeWidth={1.75}
                  />
                )}
              </svg>
            </div>

            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2.5 gap-y-1 py-1">
              {!entry ? (
                <button
                  type="button"
                  onClick={() => onToggle(node.key)}
                  aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                  className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-gray-200/60 dark:hover:bg-gray-800/60"
                >
                  <RfcChevronIcon
                    expanded={!isCollapsed}
                    className="text-gray-400 dark:text-gray-500"
                  />
                  <span
                    className={
                      depth === 0
                        ? "text-sm font-semibold text-gray-900 dark:text-gray-100"
                        : "text-sm font-medium text-gray-700 dark:text-gray-300"
                    }
                  >
                    {node.label}
                  </span>
                  <span className="rounded-full bg-gray-200/70 px-1.5 py-0.5 font-mono text-xs tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                    {descendantCount}
                  </span>
                </button>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-1.5">
                    {hasChildren && (
                      <button
                        type="button"
                        onClick={() => onToggle(node.key)}
                        aria-label={
                          isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)
                        }
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      >
                        <RfcChevronIcon expanded={!isCollapsed} />
                      </button>
                    )}
                    <RfcEntryLink entry={entry} locale={locale} />
                    {hasChildren && isCollapsed && (
                      <button
                        type="button"
                        onClick={() => onToggle(node.key)}
                        aria-label={S.rfcs.expandNode(name)}
                        className="rounded-full bg-gray-200/70 px-1.5 py-0.5 font-mono text-xs tabular-nums text-gray-600 transition-colors hover:bg-gray-300/70 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                      >
                        +{descendantCount}
                      </button>
                    )}
                  </div>
                  <RfcEntryBadges entry={entry} />
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Hierarchical view of all RFCs with selectable visual styles and persistent expand/collapse state. */
export function RfcTreeView({ locale }: { locale: string }) {
  const collapsibleKeys = useMemo(() => collapsibleRfcTreeKeys(rfcTree), []);
  const validKeysSet = useMemo(() => new Set(collapsibleKeys), [collapsibleKeys]);
  const [style, setStyleState] = useState<RfcTreeStyle>(() => readRfcTreeStyle());
  const [collapsed, setCollapsedState] = useState<Set<string>>(() =>
    readRfcTreeCollapsed(validKeysSet),
  );

  const selectStyle = useCallback((next: RfcTreeStyle) => {
    setStyleState(next);
    writeRfcTreeStyle(next);
  }, []);

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
    <div className="my-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label={S.rfcs.treeStyles.label}
          className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-100/70 px-0.5 py-0.5 dark:border-gray-800 dark:bg-gray-900"
        >
          {RFC_TREE_STYLES.map((item) => {
            const active = style === item;
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectStyle(item)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {S.rfcs.treeStyles[item]}
              </button>
            );
          })}
        </div>

        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={expandAll}
            disabled={allExpanded}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:cursor-default disabled:opacity-45 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:text-gray-200"
          >
            {S.rfcs.expandAll}
          </button>
          <button
            type="button"
            onClick={collapseAll}
            disabled={allCollapsed}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:cursor-default disabled:opacity-45 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:text-gray-200"
          >
            {S.rfcs.collapseAll}
          </button>
        </div>
      </div>

      {style === "outline" ? (
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3 dark:border-gray-800 dark:bg-gray-950/60">
          <OutlineTreeBranch
            nodes={rfcTree}
            locale={locale}
            depth={0}
            collapsed={collapsed}
            onToggle={toggleNode}
          />
        </div>
      ) : style === "cards" ? (
        <CardsTreeView locale={locale} collapsed={collapsed} onToggle={toggleNode} />
      ) : style === "terminal" ? (
        <TerminalTreeView rows={rows} locale={locale} onToggle={toggleNode} />
      ) : (
        <GraphTreeView rows={rows} locale={locale} onToggle={toggleNode} />
      )}
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
