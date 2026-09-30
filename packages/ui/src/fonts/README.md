# Fonts

The faces `@prismshadow/penguin-ui` bundles, which theme names each one, what they cost, the licence
each one carries and what that licence asks of the app, and how to update them. Bundled rather than
fetched from a CDN, so the desktop build renders offline.

## Families

| theme | sans (reading) | ui (chrome) | mono | CJK |
| --- | --- | --- | --- | --- |
| Primer `github` | Mona Sans Variable (from W1a; system stack until then) | = sans | JetBrains Mono Variable behind the system mono stack (W1a) | Noto Sans SC Variable (W1a) |
| Frost `modern` | **MiSans** 400 / 500 | = sans | JetBrains Mono Variable | MiSans (the same family) |
| Console `geek` | IBM Plex Sans Variable | Commit Mono 400 / 700 | Commit Mono 400 / 700 | Noto Sans SC Variable |

Two faces per theme since the theme identities (2026-09-19): `--ui-font-ui` is the chrome's face
(`body` sets it; navigation, controls, labels, headings, badges, tables) and `--ui-font-sans` the
reading face (message text, prose, the composer's input opt in with `font-sans`). Primer and Frost
point both at one family; Console sets its chrome in Commit Mono and reads in Plex Sans. The display
face is the chrome face everywhere: Console's h1 is the mono bold, and IBM Plex Sans Condensed 600
(the old uppercase h1) stays declared in `geek.css` but unnamed until its dependency is dropped.

| family | files | source | licence |
| --- | --- | --- | --- |
| Mona Sans Variable | `github.css`: latin + latin-ext | `@fontsource-variable/mona-sans` | OFL-1.1 |
| JetBrains Mono Variable | `github.css`: latin + latin-ext (Frost names the same faces) | `@fontsource-variable/jetbrains-mono` | OFL-1.1 |
| MiSans | `modern.css` → `misans/misans.css`: Regular as 400 and Medium as 500, 99 `unicode-range` slices each | vendored: `scripts/build-misans.py` cuts them from Xiaomi's official package | MiSans Font Intellectual Property License Agreement |
| IBM Plex Sans Variable | `geek.css`: latin + latin-ext | `@fontsource-variable/ibm-plex-sans` | OFL-1.1 |
| IBM Plex Sans Condensed | `geek.css`: 600, latin + latin-ext | `@fontsource/ibm-plex-sans-condensed` | OFL-1.1 |
| Commit Mono | `geek.css`: 400 and 700, one latin file each | `@fontsource/commit-mono` | OFL-1.1 |
| Noto Sans SC Variable | `cjk.css`: fontsource's own sheet, 101 `unicode-range` slices | `@fontsource-variable/noto-sans-sc` | OFL-1.1 |

Why these faces: Mona Sans is GitHub's product face. MiSans gives Frost one family for Latin and
Chinese, so a zh line sits in the same face as the English around it; no other face on the shortlist
has Chinese. Commit Mono, the face opencode.ai and e2b.dev ship, is Console's chrome — navigation,
controls, labels, headings — and its code face; IBM Plex Sans keeps Console's reading text
proportional, which a monospaced paragraph is not.

Frost ships two MiSans weights and no more, so `themes/modern.css` turns off weight synthesis: a 600
or 700 request renders in Medium instead of a synthesized bold, which smears Han strokes. Frost's
own tokens stop at 500.

## Loading

Font files and font declarations cost differently:

- **Files.** A browser fetches a font file only when an element's `font-family` names its family
  and its text falls inside the face's `unicode-range`. Each theme file names only its own
  families, so a session downloads its theme's faces and nothing else, and only the slices its text
  touches; Primer names no bundled family in W0 and downloads none. The consumers' Vite configs
  never inline a font (`build.assetsInlineLimit`), so every slice stays a file of its own.
- **Declarations.** `index.css` declares every theme's faces unconditionally, so all of them are
  rules in the app's main stylesheet and every session downloads them, Primer's included: about
  94 KB of the stylesheet's 122 KB gzipped, most of it the `unicode-range` lists of MiSans's 198
  faces and Noto's 101. That cost was accepted on 2026-09-18 over loading each theme's font sheet
  on demand.

Font files fetched on a specimen page (the same paragraphs, headings, controls and a code frame in
each language; Playwright network log, identical in light and dark):

| theme | English page | Chinese page |
| --- | --- | --- |
| Primer (W0: system fonts) | 0 files | 0 files |
| Frost | 5 files, 92.6 KB (MiSans 3 + 1 slices, JetBrains Mono) | 27 files, 627 KB (MiSans 16 + 10 slices, JetBrains Mono) |
| Console | 4 files, 121.7 KB (Plex Sans, Condensed 600, Commit Mono 400, 1 Noto slice for a symbol) | 17 files, 893 KB (14 Noto slices, the three Latin faces) |

## Bytes in `dist/`

Every declared face is emitted into a consumer's build (the served app, the desktop bundle, the
gallery), because the offline desktop app needs them all:

| family | files | bytes |
| --- | ---: | ---: |
| MiSans 400 | 99 | 2,121,092 |
| MiSans 500 | 99 | 2,135,204 |
| Noto Sans SC Variable | 101 | 4,516,508 |
| Mona Sans Variable | 2 | 55,312 |
| JetBrains Mono Variable | 2 | 55,600 |
| IBM Plex Sans Variable | 2 | 76,676 |
| IBM Plex Sans Condensed 600 | 2 | 35,860 |
| Commit Mono 400 / 700 | 2 | 95,432 |
| **total** | **309** | **9,091,684** |

MiSans covers the characters of Noto's slice partition plus its own other non-ideograph characters.
The roughly 15,500 rare ideographs outside that partition are not shipped (they would add 2.46 MB per
weight) and fall back to the system CJK face, as they do under the other themes.

## Licences

The `penguinUi()` Vite plugin emits every text in `LICENSES/` beside the build as
`fonts-licenses/<name>.txt`.

**OFL-1.1 faces.** `scripts/sync-font-licenses.mjs` mirrors each fontsource package's `LICENSE` into
`LICENSES/<package>.txt` (`pnpm --filter @prismshadow/penguin-ui sync:font-licenses`, `--check` to
verify without writing).

**MiSans.** Xiaomi Inc. publishes MiSans under the MiSans Font Intellectual Property License
Agreement: https://hyperos.mi.com/font-download/MiSans%E5%AD%97%E4%BD%93%E7%9F%A5%E8%AF%86%E4%BA%A7%E6%9D%83%E8%AE%B8%E5%8F%AF%E5%8D%8F%E8%AE%AE.pdf
(sha256 `4a93a27cd2bd81b3b5ecfd0a853144a876fa26938a93a68443c67d74172fcb86`, retrieved 2026-09-17).
`LICENSES/misans.txt` is that PDF's bilingual text, transcribed: paragraphs rejoined across the PDF's
line breaks, and the Kangxi-radical code points the PDF's text layer uses (`⽤` for `用`) written as
the ideographs they stand for. The sync script never rewrites it; its `--check` confirms that it is
present and names its licence (`vendored-fonts.json` lists it).

What the licence asks, and where the app does it:

| condition | how it is met |
| --- | --- |
| 1. The software states that it uses MiSans. | The Web App's account menu ends with a credit line in both dictionaries (`S.settings.fontCredit`). |
| 2. No adaptation or redevelopment of the font or its components. | The slices are subsets delivered as WOFF2: every glyph they carry keeps its outline, hinting, metrics and name, every feature and every name record is kept, and `build-misans.py` reads each finished file back and fails unless it matches the official TTF. The maintainer decided on 2026-09-17 that cutting the official TTFs into these slices is delivery, not adaptation. |
| 3. No renting, sublicensing or redistributing the font on its own. | The slices are part of the application: committed in its source tree, and shipped inside its builds and its npm package. Nothing links to them or offers them for download on their own, and the full TTF is never committed. |
| 4. Copies keep the copyright notice and the agreement. | Every slice keeps the font's name table (its copyright record included), and `fonts-licenses/misans.txt` ships beside the files in every build. |
| 5. No illegal use. | — |

## Updating

- **A fontsource face:** change the dependency, run `pnpm install`, then `sync:font-licenses`, and
  check the paths in the theme's font sheet against the package's `files/`.
- **MiSans:** download the official package from https://hyperos.mi.com/font/ (the site asks you to
  accept the licence first), then from the repository root run
  `uv run packages/ui/scripts/build-misans.py <MiSans.zip>` (or `pnpm --filter
  @prismshadow/penguin-ui fonts:misans /absolute/path/to/MiSans.zip`: pnpm runs the script in
  `packages/ui`, so a relative path would not resolve); `--check` rebuilds in a temporary directory
  and compares byte for byte. The script pins the sha256 of the Regular and Medium TTFs it accepts,
  so a new MiSans release is a deliberate change: update the pins, rebuild, review the slices, and
  re-read the licence PDF for changes.
