/** Public-site navigation. Hosts supply routes and labels; the shared UI owns layout and hover. */
import { Fragment, useRef } from "react";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { MenuIcon, XIcon } from "./site-icons";

export type SiteLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
export interface SiteLink {
  id: string;
  href: string;
  label: string;
  active?: boolean;
  /** Render an internal route through the host's router, preserving ordinary anchor behavior. */
  render?: (props: SiteLinkProps) => ReactNode;
}

function renderLink(link: SiteLink, props: SiteLinkProps) {
  return link.render ? link.render(props) : <a {...props} />;
}

export function SiteNavLinks({
  links,
  mobile = false,
  onNavigate,
}: {
  links: readonly SiteLink[];
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const highlight = useRef<HTMLSpanElement>(null);
  const visible = useRef(false);
  const slideTo = (event: MouseEvent<HTMLAnchorElement>) => {
    const pill = highlight.current;
    if (!pill) return;
    if (!visible.current) pill.style.transitionProperty = "opacity";
    pill.style.left = `${event.currentTarget.offsetLeft}px`;
    pill.style.width = `${event.currentTarget.offsetWidth}px`;
    if (!visible.current) {
      // The first hover appears in place; only subsequent targets slide.
      void pill.offsetWidth;
      pill.style.transitionProperty = "";
    }
    pill.style.opacity = "1";
    visible.current = true;
  };
  const hide = () => {
    if (highlight.current) highlight.current.style.opacity = "0";
    visible.current = false;
  };
  return (
    <nav
      aria-label={mobile ? "Mobile" : "Primary"}
      className={mobile ? "site-ui site-ui-mobile-links" : "site-ui-desktop-links"}
      onMouseLeave={hide}
    >
      {!mobile && <span ref={highlight} aria-hidden className="site-ui-highlight" />}
      {links.map((link) => (
        <Fragment key={link.id}>
          {renderLink(link, {
            href: link.href,
            className: "site-ui-nav-link",
            "aria-current": link.active ? "page" : undefined,
            onClick: onNavigate,
            onMouseEnter: mobile ? undefined : slideTo,
            children: link.label,
          })}
        </Fragment>
      ))}
    </nav>
  );
}

export function SiteHeader({
  name,
  logo,
  home,
  links,
  actions,
  menu,
  children,
}: {
  name: string;
  logo: string;
  home: SiteLink;
  links: readonly SiteLink[];
  actions: ReactNode;
  menu: {
    open: boolean;
    label: string;
    onToggle: () => void;
    hiddenClass: string;
    buttonRef?: Ref<HTMLButtonElement>;
  };
  children?: ReactNode;
}) {
  return (
    <header className="site-ui site-ui-header ui-glass">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        {renderLink(home, {
          href: home.href,
          className: "site-ui-brand",
          "aria-label": name,
          children: (
            <>
              <img src={logo} alt="" className="h-7 w-7" />
              {/* The name gives way on phones, and from where the link row appears (768 px) up to
                  the width the widest bar needs to keep it: the English docs, all six links and
                  the menu button, set in a wide system font (DejaVu Sans). */}
              <span className="site-ui-brand-name hidden sm:max-md:inline min-[882px]:inline">
                {name}
              </span>
            </>
          ),
        })}
        <SiteNavLinks links={links} />
        <div className="ml-auto flex items-center gap-1">
          {actions}
          <button
            ref={menu.buttonRef}
            type="button"
            onClick={menu.onToggle}
            aria-label={menu.label}
            aria-expanded={menu.open}
            className={`site-ui-icon-button ${menu.hiddenClass}`}
          >
            {menu.open ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {children}
    </header>
  );
}
