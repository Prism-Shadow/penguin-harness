/**
 * The top bar every page shares (unthemed): the brand, the page links — Home, Components,
 * Screens, Fonts, the current one marked — and the view controls: theme (by its display name),
 * accent (the active theme's own presets, each painted in its colour, after 随主题), root size (the
 * three real pixel sizes), language, viewport, the compare and reduced-motion toggles and the mode
 * switch. Every control writes the URL.
 *
 * At phone width the links and controls leave the bar for the drawer (chrome/site.tsx), and a menu
 * button opens it.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import { accentPresetsOf, accentSwatch, THEME_ACCENT } from "../lib/accents";
import { BASE } from "../lib/location";
import { homeHref, moduleHref, routeHref } from "../lib/routes";
import { TIER_PX } from "../lib/themes";
import { LANGS, MODE_PREFS, TIERS, VIEWS } from "../lib/url-state";
import type { ModePref } from "../lib/url-state";
import { useText } from "../preview";
import { useGallery } from "../state";
import { Segmented, Swatches, Toggle } from "./controls";
import { ChromeIcon } from "./icons";

const MODE_ICONS = { light: "sun", dark: "moon", system: "monitor" } as const;
const VIEW_ICONS = { desktop: "monitor", phone: "phone" } as const;

/** The page a link row marks as current. */
export type SitePage = "home" | "components" | "screens" | "fonts";

export function ModeSwitch() {
  const { S, state, update } = useGallery();
  return (
    <div className="g-mode" role="group" aria-label={S.rail.mode}>
      {MODE_PREFS.map((mode: ModePref) => (
        <button
          key={mode}
          type="button"
          title={S.rail.modes[mode]}
          aria-label={S.rail.modes[mode]}
          aria-pressed={state.mode === mode}
          onClick={() => update({ mode })}
        >
          <ChromeIcon name={MODE_ICONS[mode]} size={15} />
        </button>
      ))}
    </div>
  );
}

/**
 * The accent row: 随主题 first, painted in the theme's own accent, then the theme's presets, each
 * in the colour it applies in the current mode (the package's light swatch until the probe has
 * resolved the page's CSS).
 */
function AccentControl() {
  const { S, state, mode, accents, update } = useGallery();
  const resolved = accents?.[state.theme][mode] ?? {};
  const options = [THEME_ACCENT, ...accentPresetsOf(state.theme)].map((id) => ({
    value: id,
    label: id === THEME_ACCENT ? S.rail.accentTheme : id,
    color: resolved[id] || accentSwatch(state.theme, id),
  }));
  // A remembered preset the active theme does not list shows as 随主题, which is what applies.
  const shown = options.some((option) => option.value === state.accent)
    ? state.accent
    : THEME_ACCENT;
  return (
    <Swatches
      label={S.rail.accent}
      value={shown}
      options={options}
      onChange={(accent) => update({ accent })}
    />
  );
}

/**
 * The view controls. In the bar (`compact`) they sit in one row without their labels; in the
 * phone drawer and the screen toolbar each has its label.
 */
export function ViewControls({ compact = false }: { compact?: boolean }) {
  const { S, state, update } = useGallery();
  const text = useText();
  return (
    <div className="g-controls" data-compact={compact || undefined}>
      <div className="g-control">
        <span className="g-control-label">{S.rail.theme}</span>
        <Segmented
          label={S.rail.theme}
          value={state.theme}
          options={THEME_IDS.map((id) => ({ value: id, label: text.theme(id) }))}
          onChange={(theme) => update({ theme })}
        />
      </div>
      <div className="g-control">
        <span className="g-control-label">{S.rail.accent}</span>
        <AccentControl />
      </div>
      <div className="g-control">
        <span className="g-control-label">{S.rail.size}</span>
        <Segmented
          label={S.rail.size}
          value={state.tier}
          options={TIERS.map((tier) => ({
            value: tier,
            label: `${TIER_PX[tier]}px`,
            title: S.rail.sizeTitle(TIER_PX[tier]),
          }))}
          onChange={(tier) => update({ tier })}
        />
      </div>
      <div className="g-control">
        <span className="g-control-label">{S.rail.language}</span>
        <Segmented
          label={S.rail.language}
          value={state.lang}
          options={LANGS.map((lang) => ({ value: lang, label: S.rail.langNames[lang] }))}
          onChange={(lang) => update({ lang })}
        />
      </div>
      <div className="g-control">
        <span className="g-control-label">{S.rail.viewport}</span>
        <Segmented
          label={S.rail.viewport}
          value={state.view}
          options={VIEWS.map((view) => ({
            value: view,
            label: (
              <span className="g-seg-icon">
                <ChromeIcon name={VIEW_ICONS[view]} size={13} />
                {!compact && S.rail.viewports[view]}
              </span>
            ),
            title: S.rail.viewports[view],
          }))}
          onChange={(view) => update({ view })}
        />
      </div>
    </div>
  );
}

/** The compare and reduced-motion switches. */
export function ViewToggles() {
  const { S, state, update } = useGallery();
  return (
    <div className="g-toggles">
      <Toggle
        icon="columns"
        label={S.rail.compare}
        pressed={state.compare === true}
        onChange={(compare) => update({ compare })}
      />
      <Toggle
        icon="motion"
        label={S.rail.reducedMotion}
        pressed={state.motion === "reduced"}
        onChange={(on) => update({ motion: on ? "reduced" : "full" })}
      />
    </div>
  );
}

/** The page links, each carrying the view state; the current page marked. */
export function PageLinks({ current, onNavigate }: { current: SitePage; onNavigate?: () => void }) {
  const { S, state } = useGallery();
  const links: { page: SitePage; label: string; href: string }[] = [
    { page: "home", label: S.site.home, href: homeHref(BASE, state) },
    { page: "components", label: S.site.components, href: homeHref(BASE, state, "components") },
    { page: "screens", label: S.site.screens, href: moduleHref(BASE, state, "screens") },
    { page: "fonts", label: S.site.fonts, href: routeHref(BASE, state, "/fonts") },
  ];
  return (
    <>
      {links.map((link) => (
        <a
          key={link.page}
          className="g-link"
          href={link.href}
          aria-current={link.page === current ? "page" : undefined}
          onClick={onNavigate}
        >
          {link.label}
        </a>
      ))}
    </>
  );
}

export function TopBar({
  page,
  open,
  onToggle,
}: {
  page: SitePage;
  /** The phone drawer is open. */
  open: boolean;
  onToggle: () => void;
}) {
  const { S, state } = useGallery();
  return (
    <header className="g-topbar">
      <a className="g-brand" href={homeHref(BASE, state)}>
        <img src={`${BASE}/penguin-logo.svg`} alt="" width={24} height={24} />
        <strong>{S.brand.title}</strong>
      </a>
      <nav className="g-links" aria-label={S.site.pages}>
        <PageLinks current={page} />
      </nav>
      <div className="g-bar-controls">
        <ViewControls compact />
        <ViewToggles />
        <ModeSwitch />
      </div>
      <button
        type="button"
        className="g-icon-button g-menu"
        title={open ? S.site.closeMenu : S.site.menu}
        aria-label={open ? S.site.closeMenu : S.site.menu}
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChromeIcon name={open ? "close" : "menu"} />
      </button>
    </header>
  );
}
