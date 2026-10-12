/**
 * The bundled fonts' credits, for the app's Credits page: each face the package ships, which
 * themes name it by default, where it comes from, and its licence — title and full text. The
 * licences are the texts in `LICENSES/` (the mirror `scripts/sync-font-licenses.mjs` keeps and
 * `font-licenses.test.ts` holds to the packages), imported whole, so the page shows the very
 * text that ships beside the font files. A test holds this list to that directory: every text
 * credited once, every credit naming its licence, the vendored font's title and source equal to
 * `vendored-fonts.json`.
 *
 * MiSans's licence asks the software to credit the font; the sentence that does so is UI copy
 * and lives in the app's dictionaries, on the same page.
 *
 * The icon families the package's drawings come from are credited on the same page
 * (`ICON_CREDITS`, below), their licence texts in `components/icons/sets/LICENSES/`, imported
 * whole the same way.
 */
import { THEME_IDS } from "../tokens";
import type { ThemeId } from "../tokens";
import { THEME_FONTS } from "../boot";
import type { BundledFontName } from "../boot";
import ibmPlexSans from "./LICENSES/ibm-plex-sans.txt?raw";
import ibmPlexSansCondensed from "./LICENSES/ibm-plex-sans-condensed.txt?raw";
import jetbrainsMono from "./LICENSES/jetbrains-mono.txt?raw";
import misans from "./LICENSES/misans.txt?raw";
import monaSans from "./LICENSES/mona-sans.txt?raw";
import notoSansSc from "./LICENSES/noto-sans-sc.txt?raw";
import lucide from "../components/icons/sets/LICENSES/lucide.txt?raw";
import octicons from "../components/icons/sets/LICENSES/octicons.txt?raw";

export interface FontCredit {
  /** The licence file's name in `LICENSES/`, without the extension. */
  readonly id: string;
  /** The family's display name. */
  readonly family: string;
  /** The themes that name the family by default; empty for a face only the pairing offers. */
  readonly themes: readonly ThemeId[];
  /** The npm package the face arrives through, or the vendor's download for a vendored face. */
  readonly source: string;
  readonly licenseTitle: string;
  readonly licenseText: string;
}

const OFL = "SIL Open Font License 1.1";

/** The vendored face's manifest entry (`vendored-fonts.json`), spelled here so the list is plain data. */
export const MISANS_LICENSE_TITLE = "MiSans Font Intellectual Property License Agreement";
export const MISANS_SOURCE = "https://hyperos.mi.com/font-download/MiSans.zip";

const namedBy = (family: BundledFontName): readonly ThemeId[] =>
  THEME_IDS.filter((id) => Object.values(THEME_FONTS[id]).includes(family));

export const FONT_CREDITS: readonly FontCredit[] = [
  {
    id: "mona-sans",
    family: "Mona Sans",
    themes: namedBy("Mona Sans"),
    source: "@fontsource-variable/mona-sans",
    licenseTitle: OFL,
    licenseText: monaSans,
  },
  {
    id: "jetbrains-mono",
    family: "JetBrains Mono",
    themes: namedBy("JetBrains Mono"),
    source: "@fontsource-variable/jetbrains-mono",
    licenseTitle: OFL,
    licenseText: jetbrainsMono,
  },
  {
    id: "misans",
    family: "MiSans",
    themes: namedBy("MiSans"),
    source: MISANS_SOURCE,
    licenseTitle: MISANS_LICENSE_TITLE,
    licenseText: misans,
  },
  {
    id: "ibm-plex-sans",
    family: "IBM Plex Sans",
    themes: namedBy("IBM Plex Sans"),
    source: "@fontsource-variable/ibm-plex-sans",
    licenseTitle: OFL,
    licenseText: ibmPlexSans,
  },
  {
    // Declared in `fonts/geek.css` and named by no theme since Console's uppercase condensed h1
    // went; its files still ship until the dependency is dropped, so it is still credited.
    id: "ibm-plex-sans-condensed",
    family: "IBM Plex Sans Condensed",
    themes: [],
    source: "@fontsource/ibm-plex-sans-condensed",
    licenseTitle: OFL,
    licenseText: ibmPlexSansCondensed,
  },
  {
    id: "noto-sans-sc",
    family: "Noto Sans SC",
    themes: namedBy("Noto Sans SC"),
    source: "@fontsource-variable/noto-sans-sc",
    licenseTitle: OFL,
    licenseText: notoSansSc,
  },
];

export interface IconCredit {
  /** The licence file's name in `components/icons/sets/LICENSES/`, without the extension. */
  readonly id: string;
  /** The icon family's display name. */
  readonly name: string;
  /** The themes that draw the family's icons. */
  readonly themes: readonly ThemeId[];
  /** Where the drawings come from. */
  readonly source: string;
  readonly licenseTitle: string;
  readonly licenseText: string;
}

/**
 * The icon families the package's drawings come from, credited beside the fonts. The Octicons set
 * is GitHub's path data copied verbatim (`components/icons/sets/octicons.ts`), and no theme draws
 * it today; the line set's glyphs are drawn after Lucide's and Feather's, whose one licence text
 * covers both, and Frost and Primer draw them. The pixel set is drawn for this package and
 * credits nobody.
 */
export const ICON_CREDITS: readonly IconCredit[] = [
  {
    // Drawn by no theme since 2026-10-02; the set still ships, so it is still credited.
    id: "octicons",
    name: "Octicons",
    themes: [],
    source: "https://github.com/primer/octicons",
    licenseTitle: "MIT License",
    licenseText: octicons,
  },
  {
    id: "lucide",
    name: "Lucide",
    themes: ["modern", "github"],
    source: "https://github.com/lucide-icons/lucide",
    licenseTitle: "ISC License",
    licenseText: lucide,
  },
];
