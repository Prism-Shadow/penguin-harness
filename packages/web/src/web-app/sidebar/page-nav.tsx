/**
 * The sidebar's page nav: in development mode the pinned pages, then the collapsible ones folded
 * away under a slim toggle, each row with a hover pin button and, where a pointer can drag, a
 * drag across the areas; in a contributed mode that mode's own rows, all under the toggle.
 * The fold and the pin choices persist (nav-state.ts). A row's name and glyph are its page's
 * data (web-app/page-table.ts), its dot a nav badge contributed for its key — a contributed mode's
 * rows too, by their own keys, where a badge's marks stand in for the dot.
 */
import { useRef, useState, type ComponentType, type DragEvent as ReactDragEvent } from "react";

import { useLocation } from "react-router";
import {
  NavRow,
  SidebarNavArea,
  SidebarNavEntry,
  SidebarNavGroup,
  UpdateDot,
  type SidebarDropTarget,
} from "@prismshadow/penguin-ui";

import { S } from "../../lib/strings";
import { glyphOf } from "../../lib/nav-icons";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import {
  initialNavGroupCollapsed,
  initialNavPinOverrides,
  isNavPinned,
  navEntryKeysFor,
  splitNavEntries,
  storeNavGroupCollapsed,
  storeNavPinOverrides,
  withNavPinned,
  type NavEntryKey,
} from "./nav-state";

import { navPagesOf, pageTitle, useWebAppPages, type WebAppPage } from "../index";

import type { ModeNavItem } from "../../lib/sidebar-contributions";
import { isCurrentPath, renderRouterLink } from "./router-link";

/** Private drag payload type of a nav entry moved between the pinned and collapsible areas (never text/plain: use-session-drag.ts says why). */
const NAV_DRAG_MIME = "application/x-penguin-nav-entry";

/** Is the drag in flight a nav entry of ours? Authorizes a nav drop the way the session list's isGroupDrag authorizes a group drop. */
const isNavDrag = (e: ReactDragEvent): boolean => e.dataTransfer.types.includes(NAV_DRAG_MIME);

/** The two nav areas a dragged entry can be dropped into. */
type NavArea = "pinned" | "collapsible";

/**
 * The page nav's fold, pins and drag. The sidebar holds it, because the "New chat" slot above
 * the scroll area belongs to the pinned area and takes a dragged entry too (`areaDrop`).
 */
export function usePageNav(canDrag: boolean) {
  /** Folded collapsible nav area (company mode: the whole nav group); expanded by default, the choice persists across sessions. */
  const [navCollapsed, setNavCollapsed] = useState(initialNavGroupCollapsed);
  /** The main nav's pages, as the modules contributed them (web-app/page-table.ts). */
  const navPages = navPagesOf(useWebAppPages());
  /** The user's changes to which nav entries are pinned (the defaults live in nav-state.ts); persisted like the fold. */
  const [navPins, setNavPins] = useState(() => initialNavPinOverrides(navPages));
  /** Nav entry being dragged across the areas, and the area a drop would move it into. */
  const [navDrag, setNavDrag] = useState<NavEntryKey | null>(null);
  const [navDropArea, setNavDropArea] = useState<NavArea | null>(null);
  /**
   * The entry whose pin button takes focus once its row re-mounts in the other area. Moving
   * an entry moves its row to another container, and the button that had focus goes with the
   * old one — a keyboard user would be dropped onto <body>.
   */
  const pinFocusRef = useRef<NavEntryKey | null>(null);
  /** The chevron toggle: where focus goes when the moved row lands in the folded area. */
  const navToggleRef = useRef<HTMLButtonElement | null>(null);

  /** Collapse/expand the page-nav group (same store-then-set convention as setGroupMode). */
  const toggleNavGroup = () => {
    const next = !navCollapsed;
    storeNavGroupCollapsed(next);
    setNavCollapsed(next);
  };

  /**
   * Favourite or unfavourite one nav entry: the star and a drop across the areas both land here.
   * The entry simply takes its place in the other area; the star filling is the whole feedback,
   * with no reveal on the moved row (a de-blur there read as the row flickering).
   */
  const setNavPinned = (key: NavEntryKey, pinned: boolean) => {
    const next = withNavPinned(navPins, key, pinned);
    if (next === navPins) return;
    storeNavPinOverrides(next);
    setNavPins(next);
  };

  /**
   * Drag wiring of one development-mode nav entry: the row is its own handle. Offered only
   * where a pointer that can drag exists (HTML5 drag-and-drop never fires from touch); the
   * pin button is the way everywhere, and the only one there.
   */
  const navEntryDragProps = (key: NavEntryKey) =>
    canDrag
      ? {
          draggable: true,
          onDragStart: (e: ReactDragEvent) => {
            e.dataTransfer.setData(NAV_DRAG_MIME, key);
            e.dataTransfer.effectAllowed = "move";
            setNavDrag(key);
          },
          onDragEnd: () => {
            setNavDrag(null);
            setNavDropArea(null);
          },
        }
      : {};

  /**
   * Drop wiring of one nav area. Only a drag that would move the entry to this side is
   * accepted, so dropping a row back into its own area is not a drop at all; where inside the
   * area it lands is not asked, since both areas keep manifest order.
   */
  const navAreaDrop = (area: NavArea): SidebarDropTarget => ({
    over: navDropArea === area,
    onDragOver: (e) => {
      if (navDrag === null || !isNavDrag(e)) return;
      if (isNavPinned(navDrag, navPins) === (area === "pinned")) return;
      e.preventDefault();
      // The effect must be one effectAllowed permits, or the drop never fires (groupDragProps).
      e.dataTransfer.dropEffect = "move";
      setNavDropArea(area);
    },
    // Crossing onto one of the area's own rows fires dragleave too; still inside is no change.
    onDragLeave: (e) => {
      const to = e.relatedTarget;
      if (to instanceof Node && e.currentTarget.contains(to)) return;
      setNavDropArea((prev) => (prev === area ? null : prev));
    },
    onDrop: (e) => {
      if (navDrag === null || !isNavDrag(e)) return;
      e.preventDefault();
      setNavPinned(navDrag, area === "pinned");
      setNavDrag(null);
      setNavDropArea(null);
    },
  });

  return {
    navCollapsed,
    toggleNavGroup,
    navPages,
    navPins,
    navDrag,
    pinFocusRef,
    navToggleRef,
    setNavPinned,
    navEntryDragProps,
    areaDrop: navAreaDrop,
  };
}

export function PageNav({
  nav,
  modeItems,
  notes,
  marksFor,
  onNavigate,
}: {
  nav: ReturnType<typeof usePageNav>;
  /** A contributed mode's rows; null in development mode, whose rows are the contributed pages. */
  modeItems: readonly ModeNavItem[] | null;
  /** What each badged page's dot says, by page key (no entry = no dot). */
  notes: ReadonlyMap<string, string>;
  /** The marks contributed to one anchor, in order (modes.ts `marksFor`); read for a mode's rows. */
  marksFor: (anchor: string) => ReadonlyArray<{ id: string; Mark: ComponentType }>;
  onNavigate: (() => void) | undefined;
}) {
  const location = useLocation();
  const { user } = useAuth();
  const { locale } = useLocale();
  const pageByKey = new Map<string, WebAppPage>(nav.navPages.map((p) => [p.key, p]));
  /**
   * Development mode's entries by area (nav-state.ts): New chat, then the main
   * nav's pages minus the entries this user's role cannot reach, each pinned or
   * collapsible, both areas in page order. New chat is always pinned and renders in its
   * fixed slot above the scroll area, so the pinned rows here are the pages after it.
   */
  const navSplit = splitNavEntries(
    navEntryKeysFor(nav.navPages, user?.isAdmin === true),
    nav.navPins,
  );
  const pinnedNavPages = navSplit.pinned.flatMap((key) => pageByKey.get(key) ?? []);
  const collapsibleNavPages = navSplit.collapsible.flatMap((key) => pageByKey.get(key) ?? []);

  /**
   * One development-mode page entry: the package's pinnable nav row, bound to its route, its
   * badge trail, its pin choice and its drag. Four entries sit on a badge trail — Agents (an
   * outdated kernel, fixed on the Agent settings page two clicks down), Plugins, Models and the
   * Cost Center (each cleared on the page itself). The row's own label is visible, so the hint
   * only adds what the dot means, and the accessible name keeps the label as its prefix. The dot
   * hangs at the row's right edge, vertically centred on the row.
   */
  const renderNavEntry = (page: WebAppPage) => {
    const key = page.key;
    const to = page.path;
    const label = pageTitle(page, locale);
    const note = notes.get(key) ?? null;
    const pinned = isNavPinned(key, nav.navPins);
    return (
      <SidebarNavEntry
        key={key}
        label={label}
        glyph={glyphOf(page.icon)}
        href={to}
        active={isCurrentPath(to, location.pathname)}
        renderLink={renderRouterLink}
        onClick={() => onNavigate?.()}
        {...nav.navEntryDragProps(key)}
        pin={{
          pinned,
          label: S.nav.pinEntry,
          tooltip: pinned ? S.nav.unpinEntry : S.nav.pinEntry,
          onToggle: (e) => {
            // A keyboard toggle follows its row into the other area (see pinFocusRef). A row
            // that lands in the folded area is not on screen: the chevron that unfolds it is the
            // nearest place to stand, read once the move has committed, since the commit may be
            // mounting the chevron itself.
            if (e.currentTarget.matches(":focus-visible")) {
              if (pinned && nav.navCollapsed) {
                requestAnimationFrame(() => nav.navToggleRef.current?.focus());
              } else {
                nav.pinFocusRef.current = key;
              }
            }
            nav.setNavPinned(key, !pinned);
          },
          buttonRef: (el) => {
            if (el === null || nav.pinFocusRef.current !== key) return;
            nav.pinFocusRef.current = null;
            el.focus();
            // A row that lands in an area still folding away is inert and cannot take focus:
            // the chevron again, once this commit is done.
            if (document.activeElement !== el) {
              queueMicrotask(() => nav.navToggleRef.current?.focus());
            }
          },
        }}
        {...(note !== null
          ? {
              ariaLabel: `${label} · ${note}`,
              tooltip: note,
              badge: <UpdateDot size="inline" position="right-2.5 top-1/2 -translate-y-1/2" />,
            }
          : {})}
      />
    );
  };

  return (
    <SidebarNavGroup
      collapsed={nav.navCollapsed}
      onToggle={nav.toggleNavGroup}
      expandLabel={S.nav.expandGroup}
      collapseLabel={S.nav.collapseGroup}
      toggleRef={nav.navToggleRef}
      {...(modeItems !== null
        ? {}
        : {
            pinned:
              pinnedNavPages.length > 0 || nav.navDrag !== null ? (
                <SidebarNavArea drop={nav.areaDrop("pinned")} reserve={pinnedNavPages.length === 0}>
                  {pinnedNavPages.map(renderNavEntry)}
                </SidebarNavArea>
              ) : undefined,
            foldable: collapsibleNavPages.length > 0 || nav.navDrag !== null,
            drop: nav.areaDrop("collapsible"),
          })}
    >
      {modeItems !== null
        ? modeItems.map((item) => {
            const note = notes.get(item.key) ?? null;
            const marks = marksFor(item.key);
            return (
              /* A row with nowhere to go keeps its place and its glyph, muted, with nothing to
                 click or tab to. A badge's marks (a count) stand in for the dot: the number is
                 the information, and the tooltip says what it counts. */
              <NavRow
                key={item.key}
                surface="muted"
                label={item.label}
                glyph={glyphOf(item.icon)}
                href={item.to ?? ""}
                disabled={item.to === null}
                active={item.to !== null && isCurrentPath(item.to, location.pathname)}
                renderLink={renderRouterLink}
                onClick={() => onNavigate?.()}
                {...(note !== null ? { ariaLabel: `${item.label} · ${note}`, tooltip: note } : {})}
                {...(marks.length > 0
                  ? { badge: marks.map(({ id, Mark }) => <Mark key={id} />) }
                  : note !== null
                    ? {
                        badge: (
                          <UpdateDot size="inline" position="right-2.5 top-1/2 -translate-y-1/2" />
                        ),
                      }
                    : {})}
              />
            );
          })
        : collapsibleNavPages.map(renderNavEntry)}
    </SidebarNavGroup>
  );
}
