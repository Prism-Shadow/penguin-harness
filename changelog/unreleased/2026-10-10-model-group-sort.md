# Each model group sorts its models by price or by name

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `web`, `docs`

[中文版](2026-10-10-model-group-sort.zh.md)

The gear at the end of each group header on the **Models** page opened a menu instead of going straight to the group settings dialog. The menu sorted the group's models by price, low to high or high to low, or by name, and price low to high became every group's default order.

## Details

- The price compared was the blended rate billed at that moment, (cache write × 3 + output) ÷ 4 per million Tokens, taken from the same buckets the card printed: the list price less a running promotion or a live off-peak tier. The page re-sorted on the hour, when an off-peak tier can start or end. Rows a vendor bills in CNY compared at their stored USD price. Free models led the low-to-high order, models with no price ended the list in both directions, and equal prices were ordered by name.
- Sorting by name used the display name, else the model id, collated in the UI language with case ignored and digit runs read as numbers, so `GLM-5.2` came before `GLM-5.10`.
- The menu's **Sort** section held the three choices as radio rows, the current one checked; below a rule, **Group settings…** opened the dialog the gear used to open. The gear kept its icon and its accessible name, and its hover hint named the current sort. The header showed no sort label.
- The sort wrote nothing to the Project. It was remembered per group in this browser, in the `penguin.modelsGroupSort` localStorage key, which held only the groups moved off the default. Members therefore had the gear too, with the sort alone, and a page busy saving never blocked the sort. **Group settings…** stayed owner-only and waited while the page was saving.
- The order applied inside each group in every view of the page, search results included. The order of the groups, the Project config file and the chat model picker were left as they were.
- The Models documentation described the order and the menu, and the desktop quickstart's key step went through **Group settings…**.
