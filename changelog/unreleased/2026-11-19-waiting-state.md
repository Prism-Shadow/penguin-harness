# Every theme changes page at once and draws its own wait

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`
- **PR:** [#1646](https://github.com/Prism-Shadow/penguin-harness/pull/1646)

[中文版](2026-11-19-waiting-state.zh.md)

No theme played a page transition any more: moving to another page showed the next page at once in Primer, Frost, Console and Doodle alike. Frost dropped its blur and fade, Console its square dissolve and Doodle its hop. Tab and sub-page switches on the Agent, Project and system Settings pages played none either. Their loads, like the app pages', moved to one shared waiting component, `Waiting`, which each theme drew its own way.

## Details

- `Waiting` showed nothing for its first 200 ms (`WAITING_DELAY_MS`). A read that answered sooner went straight to its content. A slower read showed the placeholder on the theme's entrance. The placeholder held its space from the first frame, shaped as rows, a page's title and body, or the caller's own cards, so nothing around it moved. It was announced only once it showed.
- It carried the new style hook `ui-waiting` (`data-state`, `data-form`), and each theme drew the wait inside its placeholder blocks, which kept their boxes. Primer and Frost let the blocks breathe softly. Console typed the lines out from the top, each from the left in steps behind a block cursor, then cleared the whole wait and printed it again. Doodle wrote the lines from the top as wavy pencil strokes that drew themselves, with a paragraph of strokes down a tall block, then faded the page and wrote it again. Under Reduce Motion a wait still waited its delay, then appeared at once with its drawing at rest: still blocks, whole lines with no cursor, strokes already drawn. A placeholder block outside a wait breathed on the theme's live timing and stopped under the app's own Reduce Motion too.
- A theme pack could draw its wait the same way: the cleanliness rules counted a wait's placeholder blocks among the places a pack may decorate, draw with a pseudo-element and animate.
- `SkeletonList` was folded into `Waiting`, and every caller moved to it. The ad-hoc page placeholders (Agent settings, a Benchmark's page), the 「加载中…」 lines in Project settings and User management, and the blank wait of the Browser settings page became waiting states.
- The Memory, Vault and Schedules tabs each held one wait in place of everything their read brings: the switch, the notice, the list and the prompt arrived together, with no default switch or empty prompt drawn first. A read after a change on the Memory or Schedules tab refreshed the list in place instead of dropping back to the wait.
- The gallery's Loading board showed the waiting forms, the same forms in every theme side by side, and a replay of a quick read beside a slow one.
