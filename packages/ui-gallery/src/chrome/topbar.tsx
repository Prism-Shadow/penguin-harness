/**
 * The top bar every page shares (unthemed), one row: the brand and the page links — Home,
 * Surfaces, Foundations, Fonts, the current one marked — on the left; on the right the controls
 * a reviewer reaches for most, theme (by its display name), language and the mode switch, then a
 * button opening the rest in a popover: accent (the active theme's own presets, each painted in
 * its colour, after 随主题), text size (the five steps by name), the Latin and CJK font pairings,
 * the viewport, and under them the fonts the framed app is actually set in. Every control writes
 * the URL, and the frames reload with it.
 *
 * At phone width the links and controls leave the bar for the drawer (chrome/site.tsx), where
 * every control has its label, and a menu button opens it.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import type { ReactNode } from "react";
import { accentPresetsOf, accentSwatch, THEME_ACCENT } from "../lib/accents";
import { BASE } from "../lib/location";
import { FIRST_TOPIC } from "../library/topics";
import { HOME_SURFACE } from "../app/surfaces";
import { fontsHref, homeHref, surfaceHref, topicHref } from "../lib/routes";
import { CJK_FONTS, fontLabel, LATIN_FONTS, TEXT_SIZE_PX_NUMBER, TEXT_SIZES } from "../lib/themes";
import { LANGS, MODE_PREFS, VIEWS } from "../lib/url-state";
import type { ModePref } from "../lib/url-state";
import { useGallery } from "../state";
import { useText } from "../text";
import { Segmented, Swatches } from "./controls";
import { FontReadoutLine } from "./font-readout";
import { ChromeIcon } from "./icons";
import { Popover } from "./popover";
import { Select } from "./select";

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
          aria-label={S.rail.modes[mode]}
          data-tooltip={S.rail.modes[mode]}
          aria-pressed={state.mode === mode}
          onClick={() => update({ mode })}
        >
          <ChromeIcon name={MODE_ICONS[mode]} size={15} />
        </button>
      ))}
    </div>
  );
}

function ThemeControl() {
  const { S, state, update } = useGallery();
  const text = useText();
  return (
    <Segmented
      label={S.rail.theme}
      value={state.theme}
      options={THEME_IDS.map((id) => ({ value: id, label: text.theme(id) }))}
      onChange={(theme) => update({ theme })}
    />
  );
}

function LanguageControl() {
  const { S, state, update } = useGallery();
  return (
    <Segmented
      label={S.rail.language}
      value={state.lang}
      options={LANGS.map((lang) => ({ value: lang, label: S.rail.langNames[lang] }))}
      onChange={(lang) => update({ lang })}
    />
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

function SizeControl() {
  const { S, state, update } = useGallery();
  return (
    <Segmented
      label={S.rail.size}
      value={state.size}
      options={TEXT_SIZES.map((size) => ({
        value: size,
        label: S.rail.sizeNames[size],
        hint: S.rail.sizeTitle(S.rail.sizeNames[size], TEXT_SIZE_PX_NUMBER[size]),
      }))}
      onChange={(size) => update({ size })}
    />
  );
}

function ViewportControl() {
  const { S, state, update } = useGallery();
  return (
    <Segmented
      label={S.rail.viewport}
      value={state.view}
      options={VIEWS.map((view) => ({
        value: view,
        label: (
          <span className="g-seg-icon">
            <ChromeIcon name={VIEW_ICONS[view]} size={13} />
            {S.rail.viewports[view]}
          </span>
        ),
      }))}
      onChange={(view) => update({ view })}
    />
  );
}

/** One labelled row of the popover or the drawer. */
function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="g-control">
      <span className="g-control-label">{label}</span>
      {children}
    </div>
  );
}

/**
 * The labelled rows: the secondary controls — accent, size, the two font pairings, viewport —
 * or, in the drawer, every control. The fonts in use close the list.
 */
export function ViewControls({ all = false }: { all?: boolean }) {
  const { S, state, update } = useGallery();
  const fontWords = { theme: S.rail.fontTheme, system: S.rail.fontSystem };
  return (
    <>
      <div className="g-controls">
        {all && (
          <>
            <Control label={S.rail.theme}>
              <ThemeControl />
            </Control>
            <Control label={S.rail.mode}>
              <ModeSwitch />
            </Control>
            <Control label={S.rail.language}>
              <LanguageControl />
            </Control>
          </>
        )}
        <Control label={S.rail.accent}>
          <AccentControl />
        </Control>
        <Control label={S.rail.size}>
          <SizeControl />
        </Control>
        <Control label={S.rail.fontLatin}>
          <Select
            label={S.rail.fontLatin}
            value={state.latin}
            options={LATIN_FONTS.map((id) => ({ value: id, label: fontLabel(id, fontWords) }))}
            onChange={(latin) => update({ latin })}
          />
        </Control>
        <Control label={S.rail.fontCjk}>
          <Select
            label={S.rail.fontCjk}
            value={state.cjk}
            options={CJK_FONTS.map((id) => ({ value: id, label: fontLabel(id, fontWords) }))}
            onChange={(cjk) => update({ cjk })}
          />
        </Control>
        <Control label={S.rail.viewport}>
          <ViewportControl />
        </Control>
      </div>
      <div className="g-controls-foot">
        <FontReadoutLine />
      </div>
    </>
  );
}

/**
 * The section links, each carrying the view state, the current section marked: 界面 opens the
 * chat surface's page, 基础 the library's first topic, 字体 the fonts defaults.
 */
export function PageLinks({ current, onNavigate }: { current: SitePage; onNavigate?: () => void }) {
  const { S, state } = useGallery();
  const links: { page: SitePage; label: string; href: string }[] = [
    { page: "home", label: S.site.home, href: homeHref(BASE, state) },
    { page: "surfaces", label: S.site.surfaces, href: surfaceHref(BASE, state, HOME_SURFACE) },
    { page: "foundations", label: S.site.foundations, href: topicHref(BASE, state, FIRST_TOPIC) },
    { page: "fonts", label: S.site.fonts, href: fontsHref(BASE, state, "defaults") },
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
        <ThemeControl />
        <LanguageControl />
        <ModeSwitch />
        <Popover label={S.site.settings} icon="sliders">
          <ViewControls />
        </Popover>
      </div>
      <button
        type="button"
        className="g-icon-button g-menu"
        aria-label={open ? S.site.closeMenu : S.site.menu}
        data-tooltip={open ? S.site.closeMenu : S.site.menu}
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChromeIcon name={open ? "close" : "menu"} />
      </button>
    </header>
  );
}
