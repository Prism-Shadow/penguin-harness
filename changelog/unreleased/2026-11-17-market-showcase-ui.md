# The shared UI package gains the showcase family for the plugin market

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `ui`, `ui-gallery`
- **PR:** [#1582](https://github.com/Prism-Shadow/penguin-harness/pull/1582)

[中文版](2026-11-17-market-showcase-ui.zh.md)

The UI package gained the modules the plugin market is built from, in the Web App and on the public sites alike: a cover, a cover card and its grid, the selected carousel, a ranking beside the grid, and a product page's parts. No page used them yet; the market itself follows in its own changes.

## Details

- `Cover` draws a 16:9 picture: an authored image at its thumbnail or full rendition, or, without one or when it fails to load, a generated cover in the subject's hue with one of four motifs, the subject's icon on a tile and the product's logo in the corner (the logo takes the tile when there is no icon). While an image is on its way the box holds the picture's tone and no generated drawing. `coverHue` and `coverMotif` pick a stable hue and motif from a name.
- `CoverCard` shows the cover, a one-line title, a description held to two lines, then a foot with the tag line across and the facts beside the card's controls. `ShowcaseGrid` fits as many 17 rem columns as its own width holds; in a phone-width column a card lies down, its cover a thumbnail beside the text. `CoverCardSkeleton` is the card's placeholder.
- `ShowcaseCarousel` shows one slide at a time over a rail of thumbnails. It turns every 7 seconds, holds while hovered or in a background tab, stops on keyboard focus or a picked thumbnail until Play, and never starts by itself under reduced motion; its Play/Pause button is always there. `leadIndex` and `dayNumber` pick the leading slide by calendar day.
- `ShowcaseRanking` lists up to ten numbered rows — rank, cover thumbnail, title, tags and the figure the board ranks by — on boards the reader switches between by tabs (arrow keys, Home and End move between them); the first three ranks sit on a tinted chip, and a shortened figure says itself in full on hover and to assistive technology. Each row opens its subject. An optional `note` sits in muted text at the end of the heading's line, with its `noteHint` on hover and for assistive technology (the plugin market's "Sample data" while its figures are placeholders); `hints="title"` shows the panel's hover hints as the browser's own for a host with no tooltip layer, the public site. `ShowcaseSplit` stands it beside the grid as a right column where there is room for two card columns and the panel, and under the grid otherwise.
- `ProductHero`, `ProductGallery`, `ProductSection`, `ProductParts`, `ProductPrompt`, `ProductColumns` and `ProductFacts` lay out a product page.
- One stylesheet, `showcase.css`, names no token of either host. `theme.css` serves it in `ui-base` and maps its properties onto every theme's tokens and icon tints; `site.css` serves it in `components` and maps them onto the sites' palette. Everything is exported from both `@prismshadow/penguin-ui` and `@prismshadow/penguin-ui/site`.
- New style hook `ui-showcase` on `Cover`, `CoverCard`, `ShowcaseCarousel`, `ProductHero` and `ShowcaseRanking`, with their parts named in `data-part`. No built-in theme draws it yet.
- `ImageIcon` takes `size="fill"` to fill a square parent.
- The component gallery gained a Showcase board (every hue with every motif, the states, the cards, the carousel, the ranking with and without its note, and a product page), a plugin market group on the public-site board, and the hook's line on the hooks board.

- Cover cards can also appear as compact rows with the same actions and detail links.
