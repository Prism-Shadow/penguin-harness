# A price dot on the model cards

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#1019](https://github.com/Prism-Shadow/penguin-harness/pull/1019)

[中文版](2026-10-10-model-price-heat.zh.md)

Each card on the models page led its third line with a dot coloured by the model's price, on a continuous scale from cool (cheap) to hot (expensive), so the list could be scanned for price without reading the figures. The price moved to the head of that line, right after the dot, ahead of the context window and the key status.

## Details

- The dot encoded the blended price per million tokens, (cache-miss input × 3 + output) ÷ 4, at the rate billed right now: the list price less a running promotion and a live off-peak discount. Those are the figures the card prints, re-read on the hour, so a DeepSeek row's dot cooled at the same moment its printed price halved. Yuan prices were compared in dollars, so the display currency changed only the figures.
- The scale was logarithmic between fixed bounds, $0.125 per million tokens at the cool end and $32 at the hot end, holding the end colour beyond them. A colour therefore meant the same price whatever the search, the folded groups or the Project.
- Hovering the dot gave the blended price and a level word: low under $0.5, medium up to $2, high up to $8, and very high from $8. Free models, whose "Free" badge is their mark, and unpriced ones had no dot.
- The "?" beside the page title held the legend for every user, after the read-only note for members: what the dot encodes, the scale as a stepped strip with the four level words over it, and the two bounds and the midpoint in the display currency.
- The UI package gained the heat scale: four colour stops per theme and mode (`--ui-heat-1` … `--ui-heat-4`: slate blue, steel cyan, bronze and orange, bridged as `bg-heat-1` … `bg-heat-4`), `heatColor(t)`, which mixes the two stops around a position in OKLCH, and `HeatDot`. Every point of the scale cleared 3:1 on the canvas, the card surface and the card's hover fill in all three themes and both modes, and its hot end stayed orange, clear of the danger red. The gallery's colour foundations showed the scale.
