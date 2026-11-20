# The shared UI package gains the showcase family for the plugin market

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `ui`, `ui-gallery`
- **PR:** [#1582](https://github.com/Prism-Shadow/penguin-harness/pull/1582)

[中文版](2026-11-17-market-showcase-ui.zh.md)

The UI package gained the modules the plugin market is built from, in the Web App and on the public sites alike: a cover, a cover card and its grid, the selected carousel, and a product page's parts. No page used them yet; the market itself follows in its own changes.

## Details

- `Cover` draws a 16:9 picture: an authored image at its thumbnail or full rendition, or, without one or when it fails to load, a generated cover in the subject's hue with one of four motifs, the subject's icon on a tile and the product's logo in the corner (the logo takes the tile when there is no icon). While an image is on its way the box holds the picture's tone and no generated drawing. `coverHue` and `coverMotif` pick a stable hue and motif from a name.
- `CoverCard` shows the cover, a one-line title, a description held to two lines, then a foot with the tag line across and the facts beside the card's controls. Optional parts: `origin`, a muted line under the title naming the machine a card came from; `version`, a chip at the card's top end corner; and `bar`, text actions across the card's whole width in equal columns, each with an optional second line, a hover sentence and a disabled state. In the list layout a card with a bar keeps it under its row. `ShowcaseGrid` fits as many columns of at least 14 rem (`--showcase-column-min`) as its own width holds; in a phone-width column a card lies down, its cover a thumbnail beside the text. `CoverCardSkeleton` is the card's placeholder.
- `ShowcaseCarousel` shows one slide at a time over a rail of thumbnails, or, with `navigation="controls"`, beside the slide's place in the count ("2 / 5") with no rail, mounting only the slide on show. It turns every 7 seconds, holds while hovered or in a background tab, stops on keyboard focus or a picked thumbnail until Play, and never starts by itself under reduced motion; its Play/Pause button is always there. `leadIndex` and `dayNumber` pick the leading slide by calendar day.
- `ProductHero`, `ProductGallery`, `ProductSection`, `ProductParts`, `ProductPrompt`, `ProductColumns` and `ProductFacts` lay out a product page.
- One stylesheet, `showcase.css`, names no token of either host. `theme.css` serves it in `ui-base` and maps its properties onto every theme's tokens and icon tints; `site.css` serves it in `components` and maps them onto the sites' palette. Everything is exported from both `@prismshadow/penguin-ui` and `@prismshadow/penguin-ui/site`.
- New style hook `ui-showcase` on `Cover`, `CoverCard`, `ShowcaseCarousel` and `ProductHero`, with their parts named in `data-part`. No built-in theme draws it yet.
- `ImageIcon` takes `size="fill"` to fill a square parent.
- `StatusMark` takes `wordless` for a line with no room for the word: the glyph alone, the word leading its tooltip and kept as its text for assistive technology.
- The component gallery gained a Showcase board (every hue with every motif, the states, the cards — among them the market card with its version chip and bar, and one naming its machine — the carousel with its rail and with its controls alone, and a product page), a plugin market group on the public-site board, a wordless row of status marks on the badges board, and the hook's line on the hooks board.

- Cover cards can also appear as compact rows with the same actions and detail links.
