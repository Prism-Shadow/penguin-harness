# Frost changes page at once, and every load waits the same way

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`

[中文版](2026-11-19-waiting-state.zh.md)

Frost dropped its page transition: moving to another page now shows the next page at once, as in Primer. Console and Doodle kept theirs. Tab and sub-page switches on the Agent, Project and system Settings pages played no transition in any theme, and their loads, like the app pages', moved to one shared waiting component, `Waiting`.

## Details

- `Waiting` showed nothing for its first 200 ms (`WAITING_DELAY_MS`). A read that answered sooner went straight to its content. A slower read showed the placeholder on the theme's entrance. The placeholder held its space from the first frame, shaped as rows, a page's title and body, or the caller's own cards, so nothing around it moved. It was announced only once it showed.
- It carried the new style hook `ui-waiting` (`data-state`, `data-form`). Its blocks breathed on the theme's live timing, in steps in Console. Under Reduce Motion it still waited its delay, then appeared at once with its blocks still. A placeholder block outside a wait breathed the same way and stopped under the app's own Reduce Motion too.
- `SkeletonList` was folded into `Waiting`, and every caller moved to it. The ad-hoc page placeholders (Agent settings, a Benchmark's page), the 「加载中…」 lines in Project settings and User management, and the blank wait of the Browser settings page became waiting states.
- The Memory, Vault and Schedules tabs each held one wait in place of everything their read brings: the switch, the notice, the list and the prompt arrived together, with no default switch or empty prompt drawn first. A read after a change on the Memory or Schedules tab refreshed the list in place instead of dropping back to the wait.
- The gallery's Loading board showed the waiting forms and a replay of a quick read beside a slow one.
