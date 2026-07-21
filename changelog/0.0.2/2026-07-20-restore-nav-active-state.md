# Merge main to restore the persistent nav active highlight

The branch predated main's PR #6 ("correct navigation state and anchor scrolling"), so it was missing the nav's persistent active highlight — the black chip that marks the current section or route — and would have reverted that fix on merge. Merging origin/main brings it back and reconciles it with the branch's nav work.

- Landing nav: section links route through `/#id` again with `getActiveNavItem` tracking (new `lib/nav-state.ts` + tests), the active link keeps its black chip with `aria-current`, and the branch's in-place hover pill behavior is preserved on top.
- Also restored from #6: anchor targets scroll below the sticky header via `.section-anchor` (ids moved onto the section's inner div), footer/hero/CTA anchors as router links, and the docs brand logo returning to the landing site.
- Docs nav (landing-parity) additionally marks its own "Docs" link as the current page with the same black chip.
