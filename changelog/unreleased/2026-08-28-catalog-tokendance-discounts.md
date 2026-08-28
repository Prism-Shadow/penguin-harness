# TokenDance leads the models page, and its promoted rows show what they actually cost

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#531](https://github.com/Prism-Shadow/penguin-harness/pull/531)

[中文版](2026-08-28-catalog-tokendance-discounts.zh.md)

Tencent's Hy4 preview joined the catalog through both of its sellers, six TokenDance rows
gained a declared discount that the models page now shows and the cost center now bills at,
TokenDance became the recommended provider group and leads the page by default, the model card
was rebuilt around three fixed rows and now says what each model has spent, and the Chinese UI
renamed the three price buckets.

## The catalog

- Added `tencent/hy4-preview` to the OpenRouter group: a 1,048,576-token context window,
  text-only, at $0.834 input / $2.501 output / $0.042 cache read per million tokens.
- Added `hy4-preview` to the TokenDance group: the same upstream model reached through a
  second seller, at that gateway's own CNY 6 / 18 / 0.3 (input / output / cache hit) over a
  1,024,000-token window. Each row records what its own seller charges, so the pair is kept
  apart the same way the two `qwen3.8-flash` rows are.
- Catalog entries gained a `discount` field: the rate a seller is running off its list price.
  `pricing` stays the list price whatever promotion is live, and the new `effectivePricing()`
  applies the discount. Six TokenDance rows declare one — `deepseek-v4-flash-0731`,
  `deepseek-v4-pro-0813` and `glm-5.3-flash` at 50% off, `kimi-k3` at 20%, `glm-5.3` and
  `qwen3.8-max` at 10%.
- Corrected the list prices of `deepseek-v4-flash-0731` and `deepseek-v4-pro-0813` in the
  TokenDance group, which had recorded the promotional rate as the list price: they doubled,
  to CNY 0.1 / 3 / 9 and CNY 0.3 / 9 / 27 (cache hit / input / output), so that 50% off
  reproduces the rate TokenDance bills.
- `presetModelEntries()` now writes the effective price into a Project rather than the list
  price, so a promoted row is costed at the rate it is billed at.

## The models page

- TokenDance is marked as the recommended provider group: it leads the default group order,
  wears a green "Recommended" pill on its own collapse bar, and is the group the page opens
  expanded on a first visit. The pill is spelled in emerald rather than through `Badge`'s
  `brand` tone, which is deliberately gray — neutral emphasis outside the status vocabulary —
  and an endorsement is neither a status nor neutral. Its English label is one word because
  this is the one group carrying five actions, making its row the most crowded on the page, and
  the vendor name beside it is what a reader needs first.
- **The model card is three fixed rows.** Its name, one size down, with what the model has
  spent on the right edge; then every standing mark on a row of its own — default, vision,
  vision proxy, fast, free, discount, in that order, so the eye learns where to look; then the
  price line. The marks had been sharing the title's line, where each was width the model's
  name had to give up. The mark row renders even when empty, at the tags' own height: most
  models carry no mark, and cards in one row of a two-column grid stretch to the tallest, so a
  collapsing row would show as uneven padding rather than as a shorter card.
- **The upstream id has left the card.** It is a detail you go looking for rather than one you
  scan by, and it is one click away in the config dialog; the width it was taking now belongs
  to the name and to the spend figure.
- **Each card says what that model has cost in Tokens** — `17.7B tokens`, grey and a size below
  the price line, on the title row's right edge. It is a lifetime figure with no date or Agent
  window, which is why it comes from its own `GET /usage/model-totals` rather than from the
  cost center's filtered aggregate, and its own request rather than the model list: a stats
  failure costs the figure, not the page. A model that has never run shows nothing rather than
  a zero, which would read as a measurement instead of an absence. `humanizeTokens` gained a
  billions tier for it, in the Web App and in the CLI that shares its conventions.
- **The card's marks are small neutral pills** — one faint surface and border whatever the mark
  says, with the hue surviving only in the text. Six marks filling six coloured chips turned the
  row into confetti; on a page whose job is scanning names, the marks are meant to be noticed
  second. Three inks group them rather than enumerate them: what the model is, what it can do,
  what it costs. They are spelled in the models page rather than in `lib/tone.ts` because they
  are identities, not judgements — "default", "vision", "free" say what a model *is*, and none
  ranks above its neighbour; the words carry the identity in every case, so the ink only sorts
  them at a glance.
- A discounted model card shows the **billed** price alone. What the row would have cost
  without the promotion answers no question a reader of this list is asking, and spending the
  price line's width on it pushes out the figures that do; the rate off list is one of the tags
  instead. A row whose price has been edited away from the catalog's shows neither.
- **A narrow group header can no longer overlap its own actions.** The vendor name is the one
  element that takes the leftover space and the one that truncates; giving it a minimum width
  was what caused the overlap, since the marks beside it never shrink, so once their widths plus
  that floor exceeded the button the whole group overflowed and ran under the actions. The floor
  is gone and the model count and the recommendation drop out on a narrow row instead — the same
  rule the actions' own labels already followed. Verified with no overflow at nine widths from
  1500px down to 400px.

## Chinese price labels

The three price buckets read `缓存命中` / `缓存未命中` / `输出` in the Chinese UI — on the
models page's price fields, in the cost center's token buckets and chart legends, and in the
CLI's `penguin config model add` price options. English labels are unchanged, as are the
field, type and wire names.

## Existing Projects

Presets are copied into `.project_config.toml` when a Project is created and nothing rewrites
them afterwards, so none of the price changes above reach an existing Project on their own.
They arrive only through the models page's **sync presets**, which lowers the six promoted
TokenDance rows to the rate they are billed at; the corrected DeepSeek list prices likewise
reach an existing Project only if it syncs. The default group order and the first-visit
expanded group are defaults: a Project that has ever dragged a group header, or toggled a
group open, keeps its own arrangement untouched.
