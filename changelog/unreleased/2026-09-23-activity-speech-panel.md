# Speech coverage in the manner of Loom's Audios panel

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `web`

The Audios section, which Penguin calls speech coverage, now reads like Loom's Audios panel:
each narration's state comes from its latest speech run as well as its binding.

## Details

- A narration is **Generating…** while a speech run works on it, and **Failed** when its
  latest run ended without speech. The run's reason is shown on the row, which has a **Try
  again** action.
- Filters with counts (All, Needs speech, Failed, Bound, Needs a script) narrow the list.
- With more than one language, each language's bound and total narrations are shown
  ("es-MX 3/5"). Choosing one switches to it.
- Generating every missing narration now also retries the failed ones. Narrations already
  generating are not started twice.
