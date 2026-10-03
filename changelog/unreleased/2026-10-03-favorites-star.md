# A star marks the sidebar entries and model groups that never fold away

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `ui`, `web`, `docs`
- **PR:** [#966](https://github.com/Prism-Shadow/penguin-harness/pull/966)

[中文版](2026-10-03-favorites-star.zh.md)

The toggle that keeps a sidebar entry or a model group out of the folded area became a favorite:
the lock it used to draw read as permission or secrecy, so the owner asked for a star.

## Changes

- **Glyph:** sidebar nav entries and model group headers draw a star, outlined while the item can
  fold away and filled once it is a favorite. A new `star` icon key has a drawing in every theme's
  set (the line path, the Octicons `star` / `star-fill` pair, a 16×16 pixel star and an amber
  duotone tint); `lock` and `lockOpen` left the registry, since nothing else drew them.
- **Wording:** 常驻 / 取消常驻 became 收藏 / 取消收藏, and "Pin" / "Unpin" became "Add to
  favorites" / "Remove from favorites", on both toggles. What the toggle does is unchanged, and so
  are the stored choices: a favorite always shows, everything else sits in the fold.
- **Docs:** the Web App and Models pages describe the star.
