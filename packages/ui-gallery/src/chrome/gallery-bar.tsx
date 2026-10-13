/**
 * The gallery's own bar, under the site navbar (site/nav.tsx), one row: the gallery's pages —
 * Overview, Surfaces, Foundations, Fonts, the current one ruled underneath — on the left; on the
 * right the theme under test (by its display name), then a button opening the rest in a popover:
 * accent (the active theme's own presets, each painted in its colour, after the theme's own),
 * text size (the five steps by name), the Latin and CJK font pairings, the viewport, and under
 * them the fonts the framed app is actually set in. Every control writes the URL, and the frames
 * reload with it. Light/dark and the language are not here: the site navbar's toggles set them,
 * for the gallery and the other two sites at once.
 *
 * On a phone the page links scroll sideways if they do not fit, and the theme moves into the
 * popover.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import type { ReactNode } from "react";
import { accentPresetsOf, accentSwatch, THEME_ACCENT } from "../lib/accents";
import { BASE } from "../lib/location";
import { FIRST_TOPIC } from "../library/topics";
import { HOME_SURFACE } from "../app/surfaces";
import { fontsHref, homeHref, surfaceHref, topicHref } from "../lib/routes";
import { CJK_FONTS, fontLabel, LATIN_FONTS, TEXT_SIZE_PX_NUMBER, TEXT_SIZES } from "../lib/themes";
import { VIEWS } from "../lib/url-state";
import { useGallery } from "../state";
import { useText } from "../text";
import { Segmented, Swatches } from "./controls";
import { FontReadoutLine } from "./font-readout";
import { ChromeIcon } from "./icons";
import { Popover } from "./popover";
import { Select } from "./select";

const VIEW_ICONS = { desktop: "monitor", phone: "phone" } as const;

/** The page a link row marks as current. */
export type SitePage = "home" | "surfaces" | "foundations" | "fonts";

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

/** One labelled row of the popover; a `narrow` one only shows where the bar has no room for it. */
function Control({
  label,
  narrow = false,
  children,
}: {
  label: string;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={narrow ? "g-control g-control-narrow" : "g-control"}>
      <span className="g-control-label">{label}</span>
      {children}
    </div>
  );
}

/**
 * The labelled rows: the theme where the bar has no room for it, then accent, size, the two font
 * pairings and the viewport. The fonts in use close the list.
 */
function ViewControls() {
  const { S, state, update } = useGallery();
  const fontWords = { theme: S.rail.fontTheme, system: S.rail.fontSystem };
  return (
    <>
      <div className="g-controls">
        <Control label={S.rail.theme} narrow>
          <ThemeControl />
        </Control>
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
 * The section links, each carrying the view state, the current section marked: Surfaces opens the
 * chat surface's page, Foundations the library's first topic, Fonts the fonts defaults.
 */
function PageLinks({ current }: { current: SitePage }) {
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
        >
          {link.label}
        </a>
      ))}
    </>
  );
}

export function GalleryBar({ page }: { page: SitePage }) {
  const { S } = useGallery();
  return (
    <div className="g-bar">
      <div className="g-bar-inner">
        <nav className="g-bar-links" aria-label={S.site.pages}>
          <PageLinks current={page} />
        </nav>
        <div className="g-bar-controls">
          <div className="g-bar-theme">
            <ThemeControl />
          </div>
          <Popover label={S.site.settings} icon="sliders">
            <ViewControls />
          </Popover>
        </div>
      </div>
    </div>
  );
}
