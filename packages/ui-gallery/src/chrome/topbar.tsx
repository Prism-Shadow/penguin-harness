/**
 * The top bar every page shares (unthemed): the brand, the page links — Home, Surfaces,
 * Foundations, Fonts, the current one marked — the view controls: theme (by its display name),
 * accent (the active theme's own presets, each painted in its colour, after 随主题), text size
 * (the five steps by name), the Latin and CJK font pairings, language, viewport, the compare
 * toggle and the mode switch — and, under them, the fonts the framed app is set in. Every
 * control writes the URL, and the frames reload with it.
 *
 * At phone width the links and controls leave the bar for the drawer (chrome/site.tsx), and a menu
 * button opens it.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import { accentPresetsOf, accentSwatch, THEME_ACCENT } from "../lib/accents";
import { BASE } from "../lib/location";
import { homeHref, moduleHref, routeHref } from "../lib/routes";
import { CJK_FONTS, fontLabel, LATIN_FONTS, TEXT_SIZE_PX_NUMBER, TEXT_SIZES } from "../lib/themes";
import { LANGS, MODE_PREFS, VIEWS } from "../lib/url-state";
import type { ModePref } from "../lib/url-state";
import { useText } from "../preview";
import { useGallery } from "../state";
import { Segmented, Select, Swatches, Toggle } from "./controls";
import { FontReadoutLine } from "./font-readout";
import { ChromeIcon } from "./icons";

const MODE_ICONS = { light: "sun", dark: "moon", system: "monitor" } as const;
const VIEW_ICONS = { desktop: "monitor", phone: "phone" } as const;

/** The page a link row marks as current. */
export type SitePage = "home" | "surfaces" | "foundations" | "fonts";

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
 * phone drawer each has its label.
 */
export function ViewControls({ compact = false }: { compact?: boolean }) {
  const { S, state, update } = useGallery();
  const text = useText();
  const fontWords = { theme: S.rail.fontTheme, system: S.rail.fontSystem };
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
          value={state.size}
          options={TEXT_SIZES.map((size) => ({
            value: size,
            label: S.rail.sizeNames[size],
            title: S.rail.sizeTitle(S.rail.sizeNames[size], TEXT_SIZE_PX_NUMBER[size]),
          }))}
          onChange={(size) => update({ size })}
        />
      </div>
      <div className="g-control">
        <span className="g-control-label">{S.rail.fontLatin}</span>
        <Select
          label={S.rail.fontLatin}
          value={state.latin}
          options={LATIN_FONTS.map((id) => ({ value: id, label: fontLabel(id, fontWords) }))}
          onChange={(latin) => update({ latin })}
        />
      </div>
      <div className="g-control">
        <span className="g-control-label">{S.rail.fontCjk}</span>
        <Select
          label={S.rail.fontCjk}
          value={state.cjk}
          options={CJK_FONTS.map((id) => ({ value: id, label: fontLabel(id, fontWords) }))}
          onChange={(cjk) => update({ cjk })}
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

/** The compare switch. */
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
    </div>
  );
}

/** The page links, each carrying the view state; the current page marked. */
export function PageLinks({ current, onNavigate }: { current: SitePage; onNavigate?: () => void }) {
  const { S, state } = useGallery();
  const links: { page: SitePage; label: string; href: string }[] = [
    { page: "home", label: S.site.home, href: homeHref(BASE, state) },
    { page: "surfaces", label: S.site.surfaces, href: homeHref(BASE, state, "surfaces") },
    {
      page: "foundations",
      label: S.site.foundations,
      href: moduleHref(BASE, state, "foundations"),
    },
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
      <div className="g-bar-readout">
        <FontReadoutLine />
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
