# Perler Studio

Turn a picture into a perler-bead pattern you can build from: the grid, the colour legend, the bead count of each colour, the boards you need and the finished size.

## What it does

- Turns a picture (PNG, JPG, WebP, GIF or BMP, up to 24 MB; drag it in, pick it or paste it) into a bead grid of 29, 40, 52, 76 or 104 cells a side, or any size from 4 to 200.
- Looks at the picture first and recommends a grid size, a number of colours, a palette, a sampling method, noise merging and background handling, with the reason for each. Pro mode lets you set each one, and every change recomputes the pattern.
- Matches each cell to a bead palette by perceptual colour difference (CIEDE2000) and lists every colour's code, name and bead count, with the number of 29 x 29 or 50 x 50 boards and the finished size in centimetres.
- Calibrates the palette to the beads you own: change a colour's value, mark it out of stock, import your own palette, or swap a missing colour for its closest substitutes.
- Exports a PNG pattern with grid and legend, a CSV with one row per bead, the whole pattern as JSON, and a print page laid out for A4.
- Speaks Chinese or English: it follows your device's language, and the button in the top bar switches it and remembers your choice.

## Get started

1. On the Plugins page, install Perler Studio onto an Agent (it is not preinstalled on any Agent). Open the Agent's **Perler Studio** tab beside the chat, or its tile in the App Center.
2. The first time it opens, a sample heart is already turned into a pattern. Drag your own picture onto **Picture**, click it to choose a file, or paste one with Ctrl+V.
3. Read the **Quick** recommendation and click **Generate pattern**, or switch to **Pro** to change the settings one by one.
4. Click a row of the **Legend**, or a bead on the grid, to show only that colour; the **⋯** at the end of a row offers the closest substitutes. Then export with **PNG pattern**, **CSV data**, **JSON** or **Print page** (opened in a new tab).

### Settings

| Setting | Options | What it does |
| --- | --- | --- |
| Grid size | 29 / 40 / 52 / 76 / 104 / Custom 4-200 | Cells a side, not centimetres. Fewer cells take fewer beads: 29 is about 841 beads, 52 about 2,704 |
| Colours | Auto / up to 12, 18, 29, 40, 64 or 96 | Auto gives a budget by size (up to 36 colours at 52, 48 at 76); 96 means no cap, bounded by the palette |
| Palette | Basic 29 (Hama colour numbers) / General 96 / Pastel 40 / your own | Edit values, mark colours out of stock or import a palette under **Palette** |
| Sampling | Area average / Centre point / Most common / Median | Area average for photos; centre point for illustrations and pixel art |
| Noise merging | None / Light / Medium / Strong | Clears small specks first, then smooths single stray beads |
| Edge boost | Auto / Off | Shrinking a picture blurs its edges; Auto pulls outlines and features apart again |
| Bead size | 2.6 / 5 / 10 mm | Finished size = cells x bead size |
| Background | Remove / Keep / Fill / Transparent | Remove floods from the border colour inward |
| Framing | Crop to fill / Fit with margins | With margins, the margin takes no beads |

Keyboard: `+` / `-` zoom, `0` fit, `G` grid, `C` coordinates, `Esc` clears the isolated colour or closes a dialog.

### About the colour codes

The built-in codes follow common bead charts, and the screen colours are approximations that differ from real beads. Before you buy, compare with the beads you have: the **Palette** button at the top lets you adjust each colour or import a whole palette, one colour per line as `code,name,hex`:

```
H05,Red,#E2231A
H01,White,#FFFFFF
```

The importer needs at least four valid lines. An imported palette appears as a custom palette in the palette list. When a colour is missing, the substitute list shows candidates from the palette with their colour difference; nothing outside the palette is suggested.

## Your data

- Your settings, the language you picked, the colour values you calibrated and the palettes you imported are saved in this workbench's own state on your PenguinHarness server, with the browser's storage as a cache, so they follow the Agent from one browser to another.
- The picture you load and the pattern built from it are not saved. They stay in the page until you close or reload it; export what you want to keep.
- The picture is read and processed in your browser and is never sent anywhere. The page talks only to this workbench on your own PenguinHarness server: to keep your saves, and, when you export, to hold the exported file in memory for up to 15 minutes (at most 16 files and 48 MB together) so the browser can download it. No other host is contacted.
- Removing the workbench deletes its saves from the server. A browser that still caches them hands them back if the workbench is installed on the same Agent again.

## Make it yours

The workbench is source code in the Agent's own files, so you can ask the Agent to change it. For example:

- "Add my bead brand's palette as a built-in palette next to Basic 29. Here are the codes, names and hex values: …"
- "Split the print page into one A4 page per 29 x 29 board, with the board's rows and columns in each page's heading."

Where things are, under `workbenches/perler-studio/ui/assets/js/`: `palettes.js` holds the built-in palettes, `color.js` the colour maths, `engine.js` the pattern pipeline (sample each cell, match it to the palette, cap the colours, merge stray beads, count), `render.js` the grid drawing, `exporters.js` the four exports, `app.js` the interface, and `i18n.js` the interface text in both languages. The handler in `workbenches/perler-studio/index.ts` keeps the saves and the short-lived exports.

Updating the plugin replaces this source with the new version, your Agent's edits included.

## Licence and credits

- Apache-2.0, see [LICENSE](LICENSE).
- By Prism-Shadow, built from a workbench contributed by the PenguinHarness community.
- Nothing is bundled from elsewhere: the page uses the system's fonts, its icons are inline SVG, and the sample pictures are drawn by code.
- The Basic 29 palette numbers its colours after Hama's colour chart so that a pattern can be matched to beads in a shop. Hama is a trademark of its owner; this workbench is not affiliated with or endorsed by it.
- The colour difference is the CIEDE2000 formula, checked against the reference data of Sharma, Wu and Dalal (2005).
