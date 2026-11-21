/**
 * The RFC surface's chrome: the left sidebar rail (Search trigger + "RFCs" section with 4-digit
 * monospace numbers and short titles), the mobile collapsible navigation bar, the previous/next
 * pager, the section-level search dialog, the 5 borderless Graph Tree view variants, and the
 * shared 3-column layout shell.
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
      width="14"
      height="14"
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
  rowIndex: number;
  parentRowIndex: number | null;
  childRowIndices: number[];
  node: RfcTreeNode;
  depth: number;
  rootIndex: number;
  branchKey: string;
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
    rootIndex: number,
    rootIsLast: boolean,
    branchKey: string,
    isFirstRoot: boolean,
    parentRowIndex: number | null,
    ancestorContinues: readonly boolean[],
  ): number => {
    const children = node.children ?? [];
    const hasChildren = children.length > 0;
    const isCollapsed = hasChildren && collapsed.has(node.key);
    const visibleChildren = isCollapsed ? [] : children;
    const selfContinues = visibleChildren.length > 0 || (depth === 0 && !rootIsLast);
    const descendantCount = hasChildren ? countRfcTreeDescendantEntries(node) : 0;
    const hiddenChildCount = children.length;
    const rowIndex = rows.length;
    const childRowIndices: number[] = [];

    rows.push({
      rowIndex,
      parentRowIndex,
      childRowIndices,
      node,
      depth,
      rootIndex,
      branchKey,
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
      const nextBranch = depth === 0 ? child.key : branchKey;
      const ownColumnContinuesInChild = depth === 0 ? !childIsLast || !rootIsLast : !childIsLast;
      const childRowIdx = visit(
        child,
        depth + 1,
        rootIndex,
        rootIsLast,
        nextBranch,
        false,
        rowIndex,
        [...ancestorContinues, ownColumnContinuesInChild],
      );
      childRowIndices.push(childRowIdx);
    });

    return rowIndex;
  };
  roots.forEach((root, idx) => {
    const rootIsLast = idx === roots.length - 1;
    visit(root, 0, idx, rootIsLast, root.key, idx === 0, null, []);
  });
  return rows;
}

function RfcPrBadge({ href, number, status }: { href: string; number: number; status: RfcStatus }) {
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
  shortNum = false,
  compact = false,
}: {
  entry: RfcEntry;
  locale: string;
  shortNum?: boolean;
  compact?: boolean;
}) {
  const doc = rfcDocForLocale(entry, locale);
  const shortTitle = rfcEntryShortTitle(entry, locale);
  const numText = shortNum ? shortRfcNumber(entry.number) : entry.number;
  const textSize = compact ? "text-xs" : "text-sm";
  if (entry.status === "merged" && doc) {
    return (
      <Link
        to={`/rfcs/${entry.id}`}
        className={`group inline-flex min-w-0 items-baseline gap-1.5 ${textSize}`}
      >
        <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500 group-hover:text-brand-700 dark:text-gray-400 dark:group-hover:text-brand-300">
          {numText}
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
        className={`group inline-flex min-w-0 items-baseline gap-1.5 ${textSize}`}
      >
        <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500 group-hover:text-brand-700 dark:text-gray-400 dark:group-hover:text-brand-300">
          {numText}
        </span>
        <span className="truncate font-medium text-gray-700 group-hover:text-brand-700 dark:text-gray-300 dark:group-hover:text-brand-300">
          {shortTitle}
        </span>
      </a>
    );
  }
  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1.5 ${textSize}`}>
      <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
        {numText}
      </span>
      <span className="truncate font-medium text-gray-700 dark:text-gray-300">{shortTitle}</span>
    </span>
  );
}

// ============================================================================
// Variant 1: Horizontal 2D Node-Link Tree (`d3.tree` + `d3.linkHorizontal`)
// ============================================================================

interface HorizontalPlacedNode {
  node: RfcTreeNode;
  depth: number;
  x: number;
  cy: number;
  width: number;
  isExpandedParent: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  descendantCount: number;
  hiddenChildCount: number;
}

interface HorizontalEdge {
  key: string;
  path: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isEdition: boolean;
  isPending: boolean;
}

function linkHorizontal(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function linkStepDown(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${x1} ${y1} V ${y2 - 7} Q ${x1} ${y2} ${x1 + 7} ${y2} H ${x2}`;
}

function layoutHorizontalTree(
  roots: readonly RfcTreeNode[],
  collapsed: ReadonlySet<string>,
): { width: number; height: number; nodes: HorizontalPlacedNode[]; edges: HorizontalEdge[] } {
  const CANVAS_W = 616;
  const ROW_H = 34;
  const ROOT_GAP = 14;
  const placedNodes: HorizontalPlacedNode[] = [];
  const edges: HorizontalEdge[] = [];
  let cursorY = 0;

  const colConfigForRoot = (
    rootKey: string,
  ): { colX: readonly number[]; parentW: readonly number[] } => {
    if (rootKey === "meta") {
      return { colX: [0, 108], parentW: [80, 220] };
    }
    if (rootKey === "modules-and-plugins") {
      return { colX: [0, 174, 358, 384], parentW: [146, 156, 200, 200] };
    }
    return { colX: [0, 124, 276, 302], parentW: [96, 124, 210, 210] };
  };

  roots.forEach((root, rootIdx) => {
    if (rootIdx > 0) cursorY += ROOT_GAP;
    const { colX, parentW } = colConfigForRoot(root.key);

    const place = (node: RfcTreeNode, depth: number): HorizontalPlacedNode => {
      const children = node.children ?? [];
      const hasChildren = children.length > 0;
      const isCollapsed = hasChildren && collapsed.has(node.key);
      const visibleChildren = isCollapsed ? [] : children;
      const isExpandedParent = visibleChildren.length > 0;
      const stackedChildren = depth >= 2 && isExpandedParent;
      const x = colX[depth] ?? depth * 150;
      const width =
        isExpandedParent && !stackedChildren
          ? (parentW[depth] ?? 160)
          : Math.max(140, CANVAS_W - x);
      const descendantCount = hasChildren ? countRfcTreeDescendantEntries(node) : 0;
      const hiddenChildCount = children.length;

      let cy: number;
      if (!isExpandedParent) {
        cy = cursorY + ROW_H / 2;
        cursorY += ROW_H;
      } else if (stackedChildren) {
        // Depth >= 2 parents place their own row first, then indent children smoothly below
        // so 4-level paths never overflow the 616px article column.
        cy = cursorY + ROW_H / 2;
        cursorY += ROW_H;
        const childPlaced = visibleChildren.map((child) => place(child, depth + 1));
        const x1 = x + 12;
        const y1 = cy + 13;
        for (const cp of childPlaced) {
          const isEdition = Boolean(cp.node.editionPr);
          const isPending =
            isEdition || (cp.node.entry !== undefined && cp.node.entry.status !== "merged");
          edges.push({
            key: `${node.key}->${cp.node.key}`,
            path: linkStepDown(x1, y1, cp.x, cp.cy),
            x1,
            y1,
            x2: cp.x,
            y2: cp.cy,
            isEdition,
            isPending,
          });
        }
      } else {
        const childPlaced = visibleChildren.map((child) => place(child, depth + 1));
        const firstCy = childPlaced[0]!.cy;
        const lastCy = childPlaced[childPlaced.length - 1]!.cy;
        cy = (firstCy + lastCy) / 2;
        const x1 = x + width;
        for (const cp of childPlaced) {
          const isEdition = Boolean(cp.node.editionPr);
          const isPending =
            isEdition || (cp.node.entry !== undefined && cp.node.entry.status !== "merged");
          edges.push({
            key: `${node.key}->${cp.node.key}`,
            path: linkHorizontal(x1, cy, cp.x, cp.cy),
            x1,
            y1: cy,
            x2: cp.x,
            y2: cp.cy,
            isEdition,
            isPending,
          });
        }
      }

      const placed: HorizontalPlacedNode = {
        node,
        depth,
        x,
        cy,
        width,
        isExpandedParent: isExpandedParent && !stackedChildren,
        hasChildren,
        isCollapsed,
        descendantCount,
        hiddenChildCount,
      };
      placedNodes.push(placed);
      return placed;
    };

    place(root, 0);
  });

  return {
    width: CANVAS_W,
    height: Math.max(ROW_H, cursorY),
    nodes: placedNodes,
    edges,
  };
}

function StatusDot({ status }: { status: RfcStatus }) {
  if (status === "merged") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-purple-600 dark:bg-purple-400" />;
  }
  if (status === "open") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />;
  }
  return (
    <span className="h-2 w-2 shrink-0 rounded-full border border-gray-400 bg-transparent dark:border-gray-500" />
  );
}

function HorizontalGraphTreeView({
  locale,
  collapsed,
  onToggle,
}: {
  locale: string;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const layout = useMemo(() => layoutHorizontalTree(rfcTree, collapsed), [collapsed]);
  const NODE_H = 26;

  return (
    <div role="tree" aria-label={S.rfcs.sectionAll} className="overflow-x-auto py-1 select-none">
      <div
        className="relative"
        style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
      >
        <svg
          aria-hidden="true"
          width={layout.width}
          height={layout.height}
          className="pointer-events-none absolute inset-0"
        >
          {layout.edges.map((edge) => (
            <g key={edge.key}>
              <path
                d={edge.path}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray={edge.isEdition ? "3 3" : undefined}
                className={
                  edge.isEdition
                    ? "text-emerald-500/75 dark:text-emerald-400/70"
                    : edge.isPending
                      ? "text-gray-300 dark:text-gray-700"
                      : "text-gray-300 dark:text-gray-700"
                }
              />
              <circle
                cx={edge.x2}
                cy={edge.y2}
                r={2}
                className={
                  edge.isEdition
                    ? "fill-emerald-600 dark:fill-emerald-400"
                    : "fill-gray-400 dark:fill-gray-600"
                }
              />
            </g>
          ))}
        </svg>

        {layout.nodes.map((item) => {
          const {
            node,
            depth,
            x,
            cy,
            width,
            isExpandedParent,
            hasChildren,
            isCollapsed,
            descendantCount,
            hiddenChildCount,
          } = item;
          const entry = node.entry;
          const editionPr = node.editionPr;
          const name = nodeAccessibleName(node, locale);

          return (
            <div
              key={node.key}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={hasChildren ? !isCollapsed : undefined}
              style={{
                left: `${x}px`,
                top: `${cy - NODE_H / 2}px`,
                width: isExpandedParent ? `${width}px` : undefined,
                maxWidth: isExpandedParent ? `${width}px` : `${layout.width - x}px`,
                height: `${NODE_H}px`,
              }}
              className="absolute flex items-center select-text"
            >
              {editionPr ? (
                <a
                  href={editionPr.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`#${editionPr.number} ${editionPr.title}`}
                  className="group inline-flex h-full min-w-0 items-center gap-1.5 rounded-md border border-dashed border-emerald-400/80 bg-emerald-50/40 px-2 text-xs transition-colors hover:border-emerald-500 hover:bg-emerald-50/80 dark:border-emerald-500/40 dark:bg-emerald-950/25 dark:hover:border-emerald-400"
                >
                  <RfcPrStatusIcon status={editionPr.status} className="shrink-0" />
                  <span className="shrink-0 font-mono text-xs tabular-nums text-gray-700 group-hover:text-brand-700 dark:text-gray-300 dark:group-hover:text-brand-300">
                    #{editionPr.number}
                  </span>
                  <span className="truncate text-xs text-gray-600 group-hover:text-brand-700 dark:text-gray-400 dark:group-hover:text-brand-300">
                    {editionPr.title}
                  </span>
                </a>
              ) : !entry ? (
                <button
                  type="button"
                  onClick={() => onToggle(node.key)}
                  aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                  className={`inline-flex h-full cursor-pointer items-center justify-between gap-1 rounded-md border px-2 text-xs transition-colors ${
                    isExpandedParent ? "w-full" : ""
                  } ${
                    depth === 0
                      ? "border-gray-300 bg-gray-100/90 font-semibold text-gray-900 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-100 dark:hover:border-gray-600"
                      : "border-gray-200 bg-gray-50/90 font-medium text-gray-700 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:border-gray-700"
                  }`}
                >
                  <span className="whitespace-nowrap">{node.label}</span>
                  <span className="shrink-0 rounded-full bg-white/80 px-1 py-0.5 font-mono text-xs leading-none tabular-nums text-gray-500 dark:bg-gray-950/70 dark:text-gray-400">
                    {isCollapsed ? `+${hiddenChildCount}` : descendantCount}
                  </span>
                </button>
              ) : (
                <div
                  className={`relative inline-flex h-full min-w-0 items-center justify-between gap-1 rounded-md border border-gray-200/90 bg-white px-2 text-xs shadow-2xs transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-gray-700 ${
                    isExpandedParent ? "w-full pr-3" : ""
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <StatusDot status={entry.status} />
                    <RfcEntryLink entry={entry} locale={locale} shortNum compact />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {entry.prNumber && entry.prHref && (
                      <a
                        href={entry.prHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 font-mono text-xs tabular-nums text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                      >
                        <RfcPrStatusIcon status={entry.status} className="shrink-0" />
                        <span>#{entry.prNumber}</span>
                      </a>
                    )}
                    {hasChildren && !isExpandedParent && (
                      <button
                        type="button"
                        onClick={() => onToggle(node.key)}
                        aria-label={
                          isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)
                        }
                        className="inline-flex h-4 min-w-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-gray-300 bg-gray-50 px-1 font-mono text-xs leading-none text-gray-600 hover:border-gray-400 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                      >
                        {isCollapsed ? `+${hiddenChildCount}` : "−"}
                      </button>
                    )}
                  </div>
                  {hasChildren && isExpandedParent && (
                    <button
                      type="button"
                      onClick={() => onToggle(node.key)}
                      aria-label={S.rfcs.collapseNode(name)}
                      className="absolute -right-2 top-1/2 z-10 inline-flex h-4 w-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-gray-300 bg-white font-mono text-xs leading-none text-gray-600 hover:border-gray-400 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                    >
                      −
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Variant 2: Orthogonal Top-Down Bus Hierarchy (`org-chart-tree.ts` paradigm)
// ============================================================================

function orthogonalConnectorPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  railY: number,
  radius = 8,
): string {
  if (Math.abs(x1 - x2) < 1) return `M ${x1} ${y1} V ${y2}`;
  const dir = x2 > x1 ? 1 : -1;
  const r = Math.min(
    radius,
    Math.abs(x2 - x1) / 2,
    Math.abs(railY - y1) / 2,
    Math.abs(y2 - railY) / 2,
  );
  return (
    `M ${x1} ${y1} V ${railY - r} Q ${x1} ${railY} ${x1 + dir * r} ${railY}` +
    ` H ${x2 - dir * r} Q ${x2} ${railY} ${x2} ${railY + r} V ${y2}`
  );
}

function OrthogonalSubtreeBranch({
  node,
  locale,
  depth,
  collapsed,
  onToggle,
}: {
  node: RfcTreeNode;
  locale: string;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const isCollapsed = hasChildren && collapsed.has(node.key);
  const visibleChildren = isCollapsed ? [] : children;
  const entry = node.entry;
  const editionPr = node.editionPr;
  const name = nodeAccessibleName(node, locale);
  const descendantCount = hasChildren ? countRfcTreeDescendantEntries(node) : 0;

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren ? !isCollapsed : undefined}
    >
      <div className="flex min-h-[28px] items-center">
        {editionPr ? (
          <a
            href={editionPr.url}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex min-w-0 items-center gap-1.5 rounded-md border border-dashed border-emerald-400/80 bg-emerald-50/40 px-2 py-0.5 text-xs transition-colors hover:border-emerald-500 dark:border-emerald-500/40 dark:bg-emerald-950/25"
          >
            <RfcPrStatusIcon status={editionPr.status} className="shrink-0" />
            <span className="shrink-0 font-mono text-xs tabular-nums text-gray-700 group-hover:text-brand-700 dark:text-gray-300 dark:group-hover:text-brand-300">
              #{editionPr.number}
            </span>
            <span className="truncate text-xs text-gray-600 group-hover:text-brand-700 dark:text-gray-400 dark:group-hover:text-brand-300">
              {editionPr.title}
            </span>
          </a>
        ) : !entry ? (
          <button
            type="button"
            onClick={() => onToggle(node.key)}
            aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300/90 bg-gray-50 px-2.5 py-0.5 text-xs font-semibold text-gray-800 transition-colors hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            <span>{node.label}</span>
            <span className="rounded-full bg-white px-1.5 py-0.5 font-mono text-xs leading-none tabular-nums text-gray-500 dark:bg-gray-950 dark:text-gray-400">
              {isCollapsed ? `+${children.length}` : descendantCount}
            </span>
          </button>
        ) : (
          <div className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-gray-200/90 bg-white px-2 py-0.5 text-xs shadow-2xs dark:border-gray-800 dark:bg-gray-950">
            <StatusDot status={entry.status} />
            <RfcEntryLink entry={entry} locale={locale} shortNum compact />
            {entry.prNumber && entry.prHref && (
              <RfcPrBadge href={entry.prHref} number={entry.prNumber} status={entry.status} />
            )}
            {hasChildren && (
              <button
                type="button"
                onClick={() => onToggle(node.key)}
                aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                className="inline-flex h-4 min-w-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-gray-300 bg-gray-50 px-1 font-mono text-xs leading-none text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              >
                {isCollapsed ? `+${children.length}` : "−"}
              </button>
            )}
          </div>
        )}
      </div>

      {visibleChildren.length > 0 && (
        <div className="mt-1 space-y-1 pl-4">
          {visibleChildren.map((child, idx) => {
            const isLast = idx === visibleChildren.length - 1;
            const isEdition = Boolean(child.editionPr);
            return (
              <div key={child.key} className="relative flex items-start">
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 -left-4 h-full w-4 overflow-visible text-slate-300 dark:text-slate-700"
                >
                  {!isLast && (
                    <line x1={4} y1={0} x2={4} y2="100%" stroke="currentColor" strokeWidth={1.6} />
                  )}
                  <path
                    d="M 4 0 C 4 9, 8 14, 16 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    className={
                      isEdition ? "text-emerald-500/75 dark:text-emerald-400/70" : undefined
                    }
                  />
                </svg>
                <div className="min-w-0 flex-1">
                  <OrthogonalSubtreeBranch
                    node={child}
                    locale={locale}
                    depth={depth + 1}
                    collapsed={collapsed}
                    onToggle={onToggle}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrthogonalGraphTreeView({
  locale,
  collapsed,
  onToggle,
}: {
  locale: string;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div role="tree" aria-label={S.rfcs.sectionAll} className="space-y-6 py-1">
      {rfcTree.map((root) => {
        const children = root.children ?? [];
        const isCollapsed = collapsed.has(root.key);
        const name = nodeAccessibleName(root, locale);
        const descendantCount = countRfcTreeDescendantEntries(root);

        // Split root children into balanced columns for the top-down orthogonal bus.
        let columns: RfcTreeNode[][];
        if (children.length <= 1) {
          columns = [children];
        } else if (root.key === "modules-and-plugins") {
          columns = [[children[0]!], children.slice(1)];
        } else {
          // Harness: Agent in left column, Observability + Runtime + Distribution in right column.
          const agent = children.filter((c) => c.key === "agent");
          const others = children.filter((c) => c.key !== "agent");
          columns = agent.length > 0 && others.length > 0 ? [agent, others] : [children];
        }

        const twoCol = columns.length === 2;

        return (
          <div
            key={root.key}
            role="treeitem"
            aria-level={1}
            aria-expanded={!isCollapsed}
            className="flex flex-col items-center"
          >
            <button
              type="button"
              onClick={() => onToggle(root.key)}
              aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
              className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-gray-100/90 px-3 py-1 text-xs font-semibold text-gray-900 shadow-2xs transition-colors hover:border-gray-400 dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-100"
            >
              <span>{root.label}</span>
              <span className="rounded-full bg-white px-1.5 py-0.5 font-mono text-xs leading-none tabular-nums text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                {isCollapsed ? `+${children.length}` : descendantCount}
              </span>
            </button>

            {!isCollapsed && children.length > 0 && (
              <div className="w-full">
                {twoCol ? (
                  <>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 616 28"
                      className="hidden h-7 w-full text-slate-300 sm:block dark:text-slate-700"
                    >
                      <path
                        d={orthogonalConnectorPath(308, 0, 56, 28, 14, 10)}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.6}
                      />
                      <path
                        d={orthogonalConnectorPath(308, 0, 368, 28, 14, 10)}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.6}
                      />
                      <circle cx={308} cy={14} r={2.5} className="fill-current" />
                    </svg>
                    <div className="mt-2 grid gap-4 sm:mt-0 sm:grid-cols-2 sm:gap-5">
                      {columns.map((colNodes, colIdx) => (
                        <div key={colIdx} className="flex min-w-0 flex-col items-start">
                          {colNodes.map((child, idx) => (
                            <div key={child.key} className="w-full min-w-0">
                              {idx > 0 && (
                                <svg
                                  aria-hidden="true"
                                  className="ml-4 h-3 w-4 text-slate-300 dark:text-slate-700"
                                >
                                  <line
                                    x1={4}
                                    y1={0}
                                    x2={4}
                                    y2={12}
                                    stroke="currentColor"
                                    strokeWidth={1.6}
                                  />
                                </svg>
                              )}
                              <OrthogonalSubtreeBranch
                                node={child}
                                locale={locale}
                                depth={1}
                                collapsed={collapsed}
                                onToggle={onToggle}
                              />
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center">
                    <svg
                      aria-hidden="true"
                      width="16"
                      height="18"
                      className="text-slate-300 dark:text-slate-700"
                    >
                      <line x1={8} y1={0} x2={8} y2={18} stroke="currentColor" strokeWidth={1.6} />
                    </svg>
                    {children.map((child) => (
                      <OrthogonalSubtreeBranch
                        key={child.key}
                        node={child}
                        locale={locale}
                        depth={1}
                        collapsed={collapsed}
                        onToggle={onToggle}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Variant 3: Git Metro Graph (Fixed Left Multi-Lane Gutter + Aligned Table Rows)
// ============================================================================

interface MetroPalette {
  stroke: string;
  fill: string;
  ring: string;
  tag: string;
}

function metroPaletteFor(branchKey: string, isEdition: boolean): MetroPalette {
  if (isEdition) {
    return {
      stroke: "text-emerald-500 dark:text-emerald-400",
      fill: "fill-emerald-600 dark:fill-emerald-400",
      ring: "stroke-emerald-500 dark:stroke-emerald-400",
      tag: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    };
  }
  switch (branchKey) {
    case "meta":
    case "PRFC-0022-rfc-invariant":
      return {
        stroke: "text-amber-500 dark:text-amber-400",
        fill: "fill-amber-500 dark:fill-amber-400",
        ring: "stroke-amber-500 dark:stroke-amber-400",
        tag: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
      };
    case "modules-and-plugins":
    case "PRFC-0001-module":
      return {
        stroke: "text-indigo-500 dark:text-indigo-400",
        fill: "fill-indigo-600 dark:fill-indigo-400",
        ring: "stroke-indigo-500 dark:stroke-indigo-400",
        tag: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
      };
    case "PRFC-0003-plugin":
      return {
        stroke: "text-purple-500 dark:text-purple-400",
        fill: "fill-purple-600 dark:fill-purple-400",
        ring: "stroke-purple-500 dark:stroke-purple-400",
        tag: "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300",
      };
    case "observability":
      return {
        stroke: "text-teal-500 dark:text-teal-400",
        fill: "fill-teal-600 dark:fill-teal-400",
        ring: "stroke-teal-500 dark:stroke-teal-400",
        tag: "bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
      };
    case "runtime":
      return {
        stroke: "text-cyan-500 dark:text-cyan-400",
        fill: "fill-cyan-600 dark:fill-cyan-400",
        ring: "stroke-cyan-500 dark:stroke-cyan-400",
        tag: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300",
      };
    case "distribution":
      return {
        stroke: "text-fuchsia-500 dark:text-fuchsia-400",
        fill: "fill-fuchsia-600 dark:fill-fuchsia-400",
        ring: "stroke-fuchsia-500 dark:stroke-fuchsia-400",
        tag: "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/50 dark:text-fuchsia-300",
      };
    default:
      return {
        stroke: "text-sky-500 dark:text-sky-400",
        fill: "fill-sky-600 dark:fill-sky-400",
        ring: "stroke-sky-500 dark:stroke-sky-400",
        tag: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
      };
  }
}

function MetroGraphTreeView({
  rows,
  locale,
  onToggle,
}: {
  rows: readonly FlatTreeRow[];
  locale: string;
  onToggle: (key: string) => void;
}) {
  const GUTTER_W = 92;
  const ROW_H = 34;
  const MID = ROW_H / 2;
  const laneX = (d: number) => 12 + d * 20;
  const yOf = (idx: number) => idx * ROW_H + MID;
  const totalHeight = rows.length * ROW_H;

  // Trunk from first root down to last root's last depth-1 child.
  const R = 14;
  const rootRows = rows.filter((r) => r.depth === 0);
  const firstRootY = rootRows.length > 0 ? yOf(rootRows[0]!.rowIndex) : MID;
  const lastRootRow = rootRows[rootRows.length - 1];
  const lastTrunkRowIdx =
    lastRootRow && lastRootRow.childRowIndices.length > 0
      ? lastRootRow.childRowIndices[lastRootRow.childRowIndices.length - 1]!
      : (lastRootRow?.rowIndex ?? 0);
  const lastTrunkY = Math.max(firstRootY, yOf(lastTrunkRowIdx) - R);

  return (
    <div role="tree" aria-label={S.rfcs.sectionAll} className="relative select-none">
      {/* Unified continuous multi-lane Metro SVG canvas */}
      <svg
        aria-hidden="true"
        width={GUTTER_W}
        height={totalHeight}
        fill="none"
        className="pointer-events-none absolute top-0 left-0 z-10 overflow-visible"
      >
        {/* Layer 1: Continuous trunk + smooth S-curve metro turnouts */}
        {rootRows.length > 0 && lastTrunkY > firstRootY && (
          <line
            x1={laneX(0)}
            y1={firstRootY}
            x2={laneX(0)}
            y2={lastTrunkY}
            stroke="currentColor"
            strokeWidth={1.85}
            strokeLinecap="round"
            className="text-slate-300 dark:text-slate-600"
          />
        )}

        {rows.map((parent) => {
          if (parent.childRowIndices.length === 0) return null;
          const xp = laneX(parent.depth);
          const yp = yOf(parent.rowIndex);
          const xc = laneX(parent.depth + 1);
          return parent.childRowIndices.map((childIdx, idx) => {
            const child = rows[childIdx]!;
            const ym = yOf(childIdx);
            const isLast = idx === parent.childRowIndices.length - 1;
            const yFork = Math.max(yp, ym - R);
            const palette = metroPaletteFor(child.branchKey, Boolean(child.node.editionPr));
            const curveD =
              isLast && parent.depth > 0
                ? `M ${xp} ${yp} L ${xp} ${yFork} C ${xp} ${ym - 4.5}, ${xp + 4.5} ${ym}, ${xp + R} ${ym} H ${xc}`
                : `M ${xp} ${yFork} C ${xp} ${ym - 4.5}, ${xp + 4.5} ${ym}, ${xp + R} ${ym} H ${xc}`;
            return (
              <path
                key={`${parent.node.key}->${child.node.key}`}
                d={curveD}
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={palette.stroke}
              />
            );
          });
        })}

        {/* Subtle horizontal station leader guides */}
        {rows.map((row) => {
          const cx = laneX(row.depth);
          const cy = yOf(row.rowIndex);
          return (
            <line
              key={`leader-${row.node.key}`}
              x1={cx + 8}
              y1={cy}
              x2={GUTTER_W - 6}
              y2={cy}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="2 2.5"
              className="text-slate-200/90 dark:text-slate-800"
            />
          );
        })}

        {/* Layer 2: 360-degree breathing halo masks around every station */}
        {rows.map((row) => {
          const cx = laneX(row.depth);
          const cy = yOf(row.rowIndex);
          return (
            <circle
              key={`halo-${row.node.key}`}
              cx={cx}
              cy={cy}
              r={row.depth === 0 ? 6.75 : 6.25}
              className="fill-white dark:fill-gray-950"
            />
          );
        })}

        {/* Layer 3: Clean Metro station nodes (solid filled vs crisp hollow ring) */}
        {rows.map((row) => {
          const cx = laneX(row.depth);
          const cy = yOf(row.rowIndex);
          const entry = row.node.entry;
          const editionPr = row.node.editionPr;
          const isPending =
            Boolean(editionPr) || (entry !== undefined && entry.status !== "merged");
          const palette = metroPaletteFor(row.branchKey, Boolean(editionPr));

          if (row.depth === 0) {
            return (
              <circle
                key={`node-${row.node.key}`}
                cx={cx}
                cy={cy}
                r={4.5}
                className="fill-slate-800 dark:fill-slate-100"
              />
            );
          }

          if (isPending || (!entry && !editionPr)) {
            return (
              <circle
                key={`node-${row.node.key}`}
                cx={cx}
                cy={cy}
                r={4}
                className={`fill-white dark:fill-gray-950 ${palette.ring}`}
                strokeWidth={1.85}
              />
            );
          }

          return (
            <circle
              key={`node-${row.node.key}`}
              cx={cx}
              cy={cy}
              r={4.25}
              className={palette.fill}
            />
          );
        })}
      </svg>

      {rows.map((row) => {
        const {
          node,
          depth,
          branchKey,
          hasChildren,
          isCollapsed,
          descendantCount,
          hiddenChildCount,
        } = row;
        const cx = laneX(depth);
        const entry = node.entry;
        const editionPr = node.editionPr;
        const palette = metroPaletteFor(branchKey, Boolean(editionPr));
        const name = nodeAccessibleName(node, locale);

        return (
          <div
            key={node.key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            style={{ height: `${ROW_H}px`, paddingLeft: `${GUTTER_W}px` }}
            className="group/row relative flex items-center rounded-lg pr-1.5 transition-colors hover:bg-slate-50/90 dark:hover:bg-slate-900/45"
          >
            {hasChildren && (
              <button
                type="button"
                onClick={() => onToggle(node.key)}
                aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                style={{ left: `${cx - 10}px`, top: `${MID - 10}px` }}
                className=" absolute z-20 h-5 w-5 cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
            )}

            {/* Strictly left-aligned content column across all depths */}
            <div className="flex min-w-0 flex-1 items-center justify-between gap-2 select-text">
              <div className="flex min-w-0 items-center gap-2">
                {editionPr ? (
                  <a
                    href={editionPr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex min-w-0 items-center gap-1.5 text-xs"
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
                    className="inline-flex cursor-pointer items-center gap-2 text-left"
                  >
                    <span
                      className={
                        depth === 0
                          ? "text-sm font-semibold text-gray-900 dark:text-gray-100"
                          : `rounded px-1.5 py-0.5 text-xs font-medium ${palette.tag}`
                      }
                    >
                      {node.label}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-gray-400 dark:text-gray-500">
                      {isCollapsed ? `+${hiddenChildCount}` : descendantCount}
                    </span>
                  </button>
                ) : (
                  <>
                    <RfcEntryLink entry={entry} locale={locale} />
                    {hasChildren && isCollapsed && (
                      <button
                        type="button"
                        onClick={() => onToggle(node.key)}
                        aria-label={S.rfcs.expandNode(name)}
                        className="cursor-pointer rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-xs leading-none tabular-nums text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400"
                      >
                        +{hiddenChildCount}
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {entry?.prNumber && entry.prHref && (
                  <RfcPrBadge href={entry.prHref} number={entry.prNumber} status={entry.status} />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Variant 4 (Default): PR Stack Graph / Smartlog
// Continuous single-canvas Bezier fluid curves + 360° node halo masks + lineage hover
// ============================================================================

function SmartlogGraphTreeView({
  rows,
  locale,
  onToggle,
}: {
  rows: readonly FlatTreeRow[];
  locale: string;
  onToggle: (key: string) => void;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const CELL = 24;
  const PAD_L = 12;
  const ROW_H = 34;
  const MID = ROW_H / 2;
  const xOf = (c: number) => c * CELL + PAD_L;
  const yOf = (idx: number) => idx * ROW_H + MID;

  const maxDepth = rows.reduce((m, r) => Math.max(m, r.depth), 0);
  const svgWidth = (maxDepth + 1) * CELL + 16;
  const totalHeight = rows.length * ROW_H;

  // Compute active ancestor lineage set when a row is hovered.
  const activeLineageSet = useMemo(() => {
    const set = new Set<number>();
    if (hoveredIdx === null) return set;
    let cur: number | null = hoveredIdx;
    while (cur !== null && cur >= 0 && cur < rows.length) {
      set.add(cur);
      cur = rows[cur]!.parentRowIndex;
    }
    return set;
  }, [hoveredIdx, rows]);

  // Trunk on Column 0 spans from the first root down to the last root's last depth-1 child.
  const R = 13;
  const rootRows = rows.filter((r) => r.depth === 0);
  const firstRootY = rootRows.length > 0 ? yOf(rootRows[0]!.rowIndex) : MID;
  const lastRootRow = rootRows[rootRows.length - 1];
  const lastTrunkRowIdx =
    lastRootRow && lastRootRow.childRowIndices.length > 0
      ? lastRootRow.childRowIndices[lastRootRow.childRowIndices.length - 1]!
      : (lastRootRow?.rowIndex ?? 0);
  const lastTrunkY = Math.max(firstRootY, yOf(lastTrunkRowIdx) - R);

  const hoveredRow = hoveredIdx !== null ? rows[hoveredIdx] : undefined;
  const highlightColorClass = hoveredRow?.node.editionPr
    ? "text-emerald-500 dark:text-emerald-400"
    : hoveredRow?.node.entry?.status === "merged"
      ? "text-violet-500 dark:text-violet-400"
      : hoveredRow?.node.entry?.status === "open"
        ? "text-emerald-500 dark:text-emerald-400"
        : "text-slate-600 dark:text-slate-300";

  return (
    <div role="tree" aria-label={S.rfcs.sectionAll} className="relative select-none">
      {/* Unified full-tree vector SVG layer: zero row seams, squircle Bezier curves */}
      <svg
        aria-hidden="true"
        width={svgWidth}
        height={totalHeight}
        fill="none"
        className="pointer-events-none absolute top-0 left-0 z-10 overflow-visible"
      >
        {/* Layer 1: Base continuous trunk + clean G2-continuous squircle Bezier branch curves */}
        {rootRows.length > 0 && lastTrunkY > firstRootY && (
          <line
            x1={xOf(0)}
            y1={firstRootY}
            x2={xOf(0)}
            y2={lastTrunkY}
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            className="text-slate-300 dark:text-slate-700"
          />
        )}

        {rows.map((parent) => {
          if (parent.childRowIndices.length === 0) return null;
          const xp = xOf(parent.depth);
          const yp = yOf(parent.rowIndex);
          const xc = xOf(parent.depth + 1);

          return parent.childRowIndices.map((childIdx, idx) => {
            const child = rows[childIdx]!;
            const ym = yOf(childIdx);
            const isLast = idx === parent.childRowIndices.length - 1;
            const yFork = Math.max(yp, ym - R);
            // Smooth squircle cubic Bezier elbow (radius R = 13px) with crisp departure
            // from the vertical rail and horizontal entry into the node halo.
            const pathD =
              isLast && parent.depth > 0
                ? `M ${xp} ${yp} L ${xp} ${yFork} C ${xp} ${ym - 4.5}, ${xp + 4.5} ${ym}, ${xp + R} ${ym} H ${xc}`
                : `M ${xp} ${yFork} C ${xp} ${ym - 4.5}, ${xp + 4.5} ${ym}, ${xp + R} ${ym} H ${xc}`;

            return (
              <path
                key={`edge-${parent.node.key}->${child.node.key}`}
                d={pathD}
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-slate-300 dark:text-slate-700"
              />
            );
          });
        })}

        {/* Layer 1.5: Active ancestor lineage highlight path on hover */}
        {hoveredIdx !== null &&
          rows.map((parent) => {
            if (!activeLineageSet.has(parent.rowIndex) || parent.childRowIndices.length === 0) {
              return null;
            }
            const xp = xOf(parent.depth);
            const yp = yOf(parent.rowIndex);
            const xc = xOf(parent.depth + 1);
            return parent.childRowIndices.map((childIdx) => {
              if (!activeLineageSet.has(childIdx)) return null;
              const ym = yOf(childIdx);
              const yFork = Math.max(yp, ym - R);
              return (
                <path
                  key={`active-${parent.node.key}->${rows[childIdx]!.node.key}`}
                  d={`M ${xp} ${yp} L ${xp} ${yFork} C ${xp} ${ym - 4.5}, ${xp + 4.5} ${ym}, ${xp + R} ${ym} H ${xc}`}
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={highlightColorClass}
                />
              );
            });
          })}

        {/* Layer 2: 360-degree breathing halo cutout masks around every node */}
        {rows.map((row) => {
          const cx = xOf(row.depth);
          const cy = yOf(row.rowIndex);
          if (row.isCollapsed) {
            return (
              <rect
                key={`halo-${row.node.key}`}
                x={cx - 6.5}
                y={cy - 9.5}
                width={13}
                height={19}
                rx={6.5}
                className="fill-white dark:fill-gray-950"
              />
            );
          }
          const haloR = row.depth === 0 ? 6.75 : 6.25;
          return (
            <circle
              key={`halo-${row.node.key}`}
              cx={cx}
              cy={cy}
              r={haloR}
              className="fill-white dark:fill-gray-950"
            />
          );
        })}

        {/* Layer 3: Minimalist Solid Dots, Crisp Hollow Rings, and Folded Capsules */}
        {rows.map((row) => {
          const cx = xOf(row.depth);
          const cy = yOf(row.rowIndex);
          const entry = row.node.entry;
          const editionPr = row.node.editionPr;
          const isLineage = activeLineageSet.has(row.rowIndex);
          const isHovered = hoveredIdx === row.rowIndex;

          if (row.isCollapsed) {
            const capsuleStroke =
              entry?.status === "merged"
                ? "stroke-violet-600 dark:stroke-violet-400"
                : entry?.status === "open"
                  ? "stroke-emerald-500 dark:stroke-emerald-400"
                  : "stroke-slate-600 dark:stroke-slate-300";
            const capsuleDotFill =
              entry?.status === "merged"
                ? "fill-violet-600 dark:fill-violet-400"
                : entry?.status === "open"
                  ? "fill-emerald-500 dark:fill-emerald-400"
                  : "fill-slate-600 dark:fill-slate-300";
            return (
              <g key={`node-${row.node.key}`}>
                <rect
                  x={cx - 4.25}
                  y={cy - 7.25}
                  width={8.5}
                  height={14.5}
                  rx={4.25}
                  strokeWidth={1.75}
                  className={`fill-white dark:fill-gray-950 ${capsuleStroke}`}
                />
                <circle cx={cx} cy={cy - 2.6} r={1.3} className={capsuleDotFill} />
                <circle cx={cx} cy={cy + 2.6} r={1.3} className={capsuleDotFill} />
              </g>
            );
          }

          if (row.depth === 0) {
            return (
              <circle
                key={`node-${row.node.key}`}
                cx={cx}
                cy={cy}
                r={isHovered ? 5 : 4.5}
                className="fill-slate-800 dark:fill-slate-100"
              />
            );
          }

          if (!entry && !editionPr) {
            return (
              <circle
                key={`node-${row.node.key}`}
                cx={cx}
                cy={cy}
                r={isHovered ? 4.5 : 4}
                strokeWidth={1.85}
                className={`fill-white dark:fill-gray-950 ${
                  isLineage
                    ? "stroke-slate-700 dark:stroke-slate-200"
                    : "stroke-slate-500 dark:stroke-slate-400"
                }`}
              />
            );
          }

          const status = editionPr ? editionPr.status : entry!.status;

          if (status === "merged") {
            return (
              <circle
                key={`node-${row.node.key}`}
                cx={cx}
                cy={cy}
                r={isHovered ? 4.75 : 4.15}
                className="fill-violet-600 dark:fill-violet-400"
              />
            );
          }

          if (status === "open") {
            return (
              <circle
                key={`node-${row.node.key}`}
                cx={cx}
                cy={cy}
                r={isHovered ? 4.5 : 4}
                strokeWidth={1.85}
                className="fill-white stroke-emerald-500 dark:fill-gray-950 dark:stroke-emerald-400"
              />
            );
          }

          // Draft PR node
          return (
            <circle
              key={`node-${row.node.key}`}
              cx={cx}
              cy={cy}
              r={isHovered ? 4.5 : 4}
              strokeWidth={1.75}
              className="fill-white stroke-slate-400 dark:fill-gray-950 dark:stroke-slate-500"
            />
          );
        })}
      </svg>

      <ol className="relative">
        {rows.map((row) => {
          const {
            rowIndex,
            node,
            depth,
            hasChildren,
            isCollapsed,
            descendantCount,
            hiddenChildCount,
          } = row;
          const isHovered = hoveredIdx === rowIndex;
          const cx = xOf(depth);
          const contentLeft = (depth + 1) * CELL + 4;
          const entry = node.entry;
          const editionPr = node.editionPr;
          const name = nodeAccessibleName(node, locale);

          return (
            <li
              key={node.key}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={hasChildren ? !isCollapsed : undefined}
              onMouseEnter={() => setHoveredIdx(rowIndex)}
              onMouseLeave={() => setHoveredIdx((prev) => (prev === rowIndex ? null : prev))}
              style={{ height: `${ROW_H}px`, paddingLeft: `${contentLeft}px` }}
              className={`group/row relative flex items-center rounded-lg pr-2 transition-colors duration-150 ${
                isHovered ? "bg-slate-50/90 dark:bg-slate-900/45" : ""
              }`}
            >
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => onToggle(node.key)}
                  aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                  style={{ left: `${cx - 10}px`, top: `${MID - 10}px` }}
                  className="absolute z-20 h-5 w-5 cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                />
              )}

              <div className="flex min-w-0 flex-1 items-center justify-between gap-2 select-text">
                <div className="flex min-w-0 items-center gap-2">
                  {editionPr ? (
                    <a
                      href={editionPr.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group inline-flex min-w-0 items-center gap-1.5 text-xs"
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
                      className="inline-flex cursor-pointer items-center gap-2 text-left"
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
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-xs leading-none tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {isCollapsed ? `+${hiddenChildCount}` : descendantCount}
                      </span>
                    </button>
                  ) : (
                    <>
                      <RfcEntryLink entry={entry} locale={locale} />
                      {hasChildren && isCollapsed && (
                        <button
                          type="button"
                          onClick={() => onToggle(node.key)}
                          aria-label={S.rfcs.expandNode(name)}
                          className="cursor-pointer rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-xs leading-none tabular-nums text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                        >
                          +{hiddenChildCount}
                        </button>
                      )}
                    </>
                  )}
                </div>

                {entry?.prNumber && entry.prHref && (
                  <RfcPrBadge href={entry.prHref} number={entry.prNumber} status={entry.status} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ============================================================================
// Variant 5: Curved Spine Hierarchy Tree (Continuous Spine + Inflection S-Curves)
// ============================================================================

function SpineGraphTreeView({
  rows,
  locale,
  onToggle,
}: {
  rows: readonly FlatTreeRow[];
  locale: string;
  onToggle: (key: string) => void;
}) {
  const LANE = 24;
  const ROW_H = 32;
  const CY = ROW_H / 2;
  const xOf = (d: number) => d * LANE + 12;
  const yOf = (idx: number) => idx * ROW_H + CY;
  const maxDepth = rows.reduce((m, r) => Math.max(m, r.depth), 0);
  const svgWidth = (maxDepth + 1) * LANE + 16;
  const totalHeight = rows.length * ROW_H;

  const R = 13;
  const rootRows = rows.filter((r) => r.depth === 0);
  const firstRootY = rootRows.length > 0 ? yOf(rootRows[0]!.rowIndex) : CY;
  const lastRootRow = rootRows[rootRows.length - 1];
  const lastTrunkRowIdx =
    lastRootRow && lastRootRow.childRowIndices.length > 0
      ? lastRootRow.childRowIndices[lastRootRow.childRowIndices.length - 1]!
      : (lastRootRow?.rowIndex ?? 0);
  const lastTrunkY = Math.max(firstRootY, yOf(lastTrunkRowIdx) - R);

  return (
    <div role="tree" aria-label={S.rfcs.sectionAll} className="relative select-none">
      <svg
        aria-hidden="true"
        width={svgWidth}
        height={totalHeight}
        fill="none"
        className="pointer-events-none absolute top-0 left-0 z-10 overflow-visible"
      >
        {/* Layer 1: Continuous spine + smooth cubic Bezier branches */}
        {rootRows.length > 0 && lastTrunkY > firstRootY && (
          <line
            x1={xOf(0)}
            y1={firstRootY}
            x2={xOf(0)}
            y2={lastTrunkY}
            stroke="currentColor"
            strokeWidth={1.65}
            strokeLinecap="round"
            className="text-slate-300 dark:text-slate-700"
          />
        )}

        {rows.map((parent) => {
          if (parent.childRowIndices.length === 0) return null;
          const xp = xOf(parent.depth);
          const yp = yOf(parent.rowIndex);
          const xc = xOf(parent.depth + 1);
          const R = 13;
          return parent.childRowIndices.map((childIdx, idx) => {
            const child = rows[childIdx]!;
            const ym = yOf(childIdx);
            const isLast = idx === parent.childRowIndices.length - 1;
            const yFork = Math.max(yp, ym - R);
            const pathD =
              isLast && parent.depth > 0
                ? `M ${xp} ${yp} L ${xp} ${yFork} C ${xp} ${ym - 4.5}, ${xp + 4.5} ${ym}, ${xp + R} ${ym} H ${xc}`
                : `M ${xp} ${yFork} C ${xp} ${ym - 4.5}, ${xp + 4.5} ${ym}, ${xp + R} ${ym} H ${xc}`;
            return (
              <path
                key={`spine-${parent.node.key}->${child.node.key}`}
                d={pathD}
                stroke="currentColor"
                strokeWidth={1.65}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-slate-300 dark:text-slate-700"
              />
            );
          });
        })}

        {/* Layer 2: Halo masks */}
        {rows.map((row) => {
          const cx = xOf(row.depth);
          const cy = yOf(row.rowIndex);
          return (
            <circle
              key={`halo-${row.node.key}`}
              cx={cx}
              cy={cy}
              r={row.hasChildren ? 8 : 6.25}
              className="fill-white dark:fill-gray-950"
            />
          );
        })}

        {/* Layer 3: +/- Circle Collapse Buttons & Leaf Nodes */}
        {rows.map((row) => {
          const cx = xOf(row.depth);
          const cy = yOf(row.rowIndex);
          const entry = row.node.entry;
          const editionPr = row.node.editionPr;

          const nodeStrokeClass = !entry
            ? row.depth === 0
              ? "stroke-slate-700 dark:stroke-slate-200"
              : "stroke-slate-500 dark:stroke-slate-400"
            : entry.status === "merged"
              ? "stroke-violet-600 dark:stroke-violet-400"
              : entry.status === "open"
                ? "stroke-emerald-500 dark:stroke-emerald-400"
                : "stroke-slate-400 dark:stroke-slate-500";

          const nodeGlyphColorClass = !entry
            ? row.depth === 0
              ? "text-slate-700 dark:text-slate-200"
              : "text-slate-500 dark:text-slate-400"
            : entry.status === "merged"
              ? "text-violet-600 dark:text-violet-400"
              : entry.status === "open"
                ? "text-emerald-500 dark:text-emerald-400"
                : "text-slate-500 dark:text-slate-400";

          if (row.hasChildren) {
            return (
              <g key={`node-${row.node.key}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={6}
                  className={`fill-white dark:fill-gray-950 ${nodeStrokeClass}`}
                  strokeWidth={1.6}
                />
                <line
                  x1={cx - 2.5}
                  y1={cy}
                  x2={cx + 2.5}
                  y2={cy}
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  className={nodeGlyphColorClass}
                />
                {row.isCollapsed && (
                  <line
                    x1={cx}
                    y1={cy - 2.5}
                    x2={cx}
                    y2={cy + 2.5}
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    className={nodeGlyphColorClass}
                  />
                )}
              </g>
            );
          }

          if (editionPr) {
            return (
              <g key={`node-${row.node.key}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={4.25}
                  className={
                    editionPr.status === "open"
                      ? "fill-white stroke-emerald-500 dark:fill-gray-950 dark:stroke-emerald-400"
                      : "fill-white stroke-slate-400 dark:fill-gray-950 dark:stroke-slate-500"
                  }
                  strokeWidth={1.6}
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={1.5}
                  className={
                    editionPr.status === "open"
                      ? "fill-emerald-500 dark:fill-emerald-400"
                      : "fill-slate-400 dark:fill-slate-500"
                  }
                />
              </g>
            );
          }

          if (entry?.status === "merged") {
            return (
              <circle
                key={`node-${row.node.key}`}
                cx={cx}
                cy={cy}
                r={4.25}
                className="fill-violet-600 dark:fill-violet-400"
              />
            );
          }

          if (entry?.status === "open") {
            return (
              <g key={`node-${row.node.key}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={4.25}
                  className="fill-white stroke-emerald-500 dark:fill-gray-950 dark:stroke-emerald-400"
                  strokeWidth={1.65}
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={1.65}
                  className="fill-emerald-500 dark:fill-emerald-400"
                />
              </g>
            );
          }

          return (
            <circle
              key={`node-${row.node.key}`}
              cx={cx}
              cy={cy}
              r={4}
              className="fill-white stroke-slate-400 dark:fill-gray-950 dark:stroke-slate-500"
              strokeWidth={1.65}
            />
          );
        })}
      </svg>

      {rows.map((row) => {
        const { node, depth, hasChildren, isCollapsed, descendantCount, hiddenChildCount } = row;
        const cx = xOf(depth);
        const contentLeft = (depth + 1) * LANE + 4;
        const entry = node.entry;
        const editionPr = node.editionPr;
        const name = nodeAccessibleName(node, locale);

        return (
          <div
            key={node.key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            style={{ height: `${ROW_H}px`, paddingLeft: `${contentLeft}px` }}
            className=" relative flex items-center rounded-lg pr-1.5 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/40"
          >
            {hasChildren && (
              <button
                type="button"
                onClick={() => onToggle(node.key)}
                aria-label={isCollapsed ? S.rfcs.expandNode(name) : S.rfcs.collapseNode(name)}
                style={{ left: `${cx - 10}px`, top: `${CY - 10}px` }}
                className="absolute z-20 h-5 w-5 cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
            )}

            <div className="flex min-w-0 flex-1 items-center gap-2 select-text">
              {editionPr ? (
                <a
                  href={editionPr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex min-w-0 items-center gap-1.5 text-xs"
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
                  className="inline-flex cursor-pointer items-center gap-2 text-left"
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
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-xs leading-none tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
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
                      className="cursor-pointer rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-xs leading-none tabular-nums text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
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

/** Hierarchical Graph tree view of all RFCs with 5 borderless graph paradigms and persistent state. */
export function RfcTreeView({ locale, headingId }: { locale: string; headingId?: string }) {
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
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2
          id={headingId}
          className="scroll-mt-24 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100"
        >
          {S.rfcs.sectionAll}
        </h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <div
            role="tablist"
            aria-label={S.rfcs.treeStyles.label}
            className="inline-flex flex-wrap items-center gap-1"
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
                  className={`cursor-pointer rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                  }`}
                >
                  {S.rfcs.treeStyles[item]}
                </button>
              );
            })}
          </div>
          <div className="inline-flex items-center gap-2 border-l border-gray-200 pl-3 dark:border-gray-800">
            <button
              type="button"
              onClick={expandAll}
              disabled={allExpanded}
              className="cursor-pointer text-gray-500 transition-colors hover:text-gray-900 disabled:cursor-default disabled:opacity-40 dark:text-gray-400 dark:hover:text-gray-100"
            >
              {S.rfcs.expandAll}
            </button>
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
      </div>

      {style === "horizontal" ? (
        <HorizontalGraphTreeView locale={locale} collapsed={collapsed} onToggle={toggleNode} />
      ) : style === "orthogonal" ? (
        <OrthogonalGraphTreeView locale={locale} collapsed={collapsed} onToggle={toggleNode} />
      ) : style === "metro" ? (
        <MetroGraphTreeView rows={rows} locale={locale} onToggle={toggleNode} />
      ) : style === "smartlog" ? (
        <SmartlogGraphTreeView rows={rows} locale={locale} onToggle={toggleNode} />
      ) : (
        <SpineGraphTreeView rows={rows} locale={locale} onToggle={toggleNode} />
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
            <SiteToc
              label={S.rfcs.toc}
              entries={toc}
              activeId={activeTocId}
              onNavigate={onPinToc}
            />
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
