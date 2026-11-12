/**
 * A group of the site bar's pages (SiteLinkGroup): a menu in the bar's row, an indented group in
 * the phone menu. SiteNavLinks lays them out with the bar's other entries.
 */
import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Dropdown } from "../overlays/dropdown/dropdown";
import { Menu } from "../overlays/menu/menu";
import { ChevronDownIcon } from "./site-icons";
import { renderSiteLink } from "./site-link";
import type { SiteLinkGroup } from "./site-link";

/**
 * How long a menu the pointer opened stays open once the pointer is off it (ms): long enough to
 * cross the gap between the trigger and the panel, short enough to read as following the pointer.
 */
const HOVER_CLOSE_DELAY = 150;

/**
 * A group in the bar's row: a trigger in the row's own style that opens the group's pages in a
 * menu. Hovering opens it until the pointer leaves; a press (a click, a tap, Enter or Space)
 * opens it, or keeps a hovered one open, until a page is chosen, Escape, a second press or a
 * press elsewhere. Escape hands focus back to the trigger, and Tab out of the menu closes it.
 *
 * The panel is portaled (the shared Dropdown's popup layer), so a host's own sticky bar under the
 * site bar, the gallery's, cannot cover it. React still counts it inside this entry for hover;
 * focus is checked against it by hand, since the DOM does not nest it here.
 */
export function SiteNavMenu({
  group,
  onHover,
}: {
  group: SiteLinkGroup;
  /** The row's hover highlight, slid under the trigger. */
  onHover?: (event: MouseEvent<HTMLElement>) => void;
}) {
  const [openedBy, setOpenedBy] = useState<"hover" | "press" | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pages = useRef<HTMLDivElement>(null);
  useEffect(() => () => clearTimeout(closing.current), []);
  const open = openedBy !== null;
  const close = () => {
    clearTimeout(closing.current);
    setOpenedBy(null);
  };
  return (
    <div
      className="site-ui-nav-menu"
      onMouseEnter={(event) => {
        onHover?.(event);
        clearTimeout(closing.current);
        if (!open) setOpenedBy("hover");
      }}
      onMouseLeave={() => {
        if (openedBy !== "hover") return;
        clearTimeout(closing.current);
        closing.current = setTimeout(() => setOpenedBy(null), HOVER_CLOSE_DELAY);
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node)) return;
        if (!event.currentTarget.contains(next) && !pages.current?.contains(next)) close();
      }}
    >
      <Dropdown
        open={open}
        setOpen={(value) => (value ? setOpenedBy("press") : close())}
        // A menu the pointer opened leaves focus where it is: a scripted focus would draw the
        // keyboard ring on its first page as the pointer merely passes.
        focusOnOpen={openedBy !== "hover"}
        portal={{ direction: "down", align: "left" }}
        menuClass="site-ui site-ui-nav-menu-panel"
        button={
          <button
            type="button"
            className="site-ui-nav-link site-ui-nav-more"
            aria-haspopup="menu"
            aria-expanded={open}
            data-current={group.links.some((link) => link.active) || undefined}
            onClick={() => (openedBy === "press" ? close() : setOpenedBy("press"))}
          >
            {group.label}
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </button>
        }
      >
        <div ref={pages}>
          <Menu label={group.label}>
            {group.links.map((link) => (
              <Fragment key={link.id}>
                {renderSiteLink(link, {
                  href: link.href,
                  role: "menuitem",
                  className: "site-ui-nav-menu-item",
                  "aria-current": link.active ? "page" : undefined,
                  onClick: close,
                  children: link.label,
                })}
              </Fragment>
            ))}
          </Menu>
        </div>
      </Dropdown>
    </div>
  );
}

/** A group in the phone menu: its name, then its pages, set in from the pages around it. */
export function SiteNavGroupLinks({
  group,
  onNavigate,
}: {
  group: SiteLinkGroup;
  onNavigate?: () => void;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="site-ui-mobile-group">
      <span id={labelId} className="site-ui-mobile-group-label">
        {group.label}
      </span>
      {group.links.map((link) => (
        <Fragment key={link.id}>
          {renderSiteLink(link, {
            href: link.href,
            className: "site-ui-nav-link",
            "aria-current": link.active ? "page" : undefined,
            onClick: onNavigate,
            children: link.label,
          })}
        </Fragment>
      ))}
    </div>
  );
}
