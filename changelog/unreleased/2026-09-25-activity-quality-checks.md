# Check an activity's quality: easy for everyone to use, and the right reading level

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

Added **Quality** to an activity's Module section, below Build. **Check quality** opened every
scene of the played activity in the test browser and reported two results, each with its
status, a table of what it found (severity, rule or word, where, detail, and a link to axe's
page about the rule) and when it last ran. **Easy for everyone to use** checked the page against
the WCAG 2.2 AA rules with axe-core and a keyboard probe, with findings as Must fix, Should fix
or Minor; Must fix and Should fix failed it. **Right reading level** compared the narration and
the text on screen with the specification's `audience.gradeBand` and pointed out long sentences
and long or many-syllable words as Notes; it never failed. Without the test browser, Check
quality was not offered and the section said an admin installs it in System settings. Neither
result stopped an author assembling the module.

## Details

- Added `axe-core` as a server dependency, injected into the played page as it ships.
- Added the run kind `quality`: a run the server does itself, with no Session or agent,
  recorded in the activity's history under the one-run-per-activity rule. `ActivityGeneration`
  gained `openDeterministic` and `settleDeterministic` for such runs. A run wrote
  `reports/accessibility.json` and `reports/readability.json` into its workspace
  (`activity-runs/<runId>/`); the latest succeeded run's reports were the activity's.
- Added `POST /api/projects/:projectId/activities/:activityId/quality` (project owner), which
  started the run and answered 202 with it: 409 `test_browser_missing` without the test
  browser, 409 `quality_not_playable` when there was no module to play, and 409
  `generation_running` while another run went. Added `GET` on the same path, answering
  `{ quality: { runId, accessibility, readability } | null, browserInstalled }`.
- Added the kernel service `ActivityQuality`. For each scene it opened the player on that scene
  at the specification's resolution, waited for the player's inspection bridge (at most five
  seconds), ran axe for the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`, and
  ran a probe that reported whether each visible control took keyboard focus, showed it, and
  worked with Enter or Space (`keyboard-focusable`, `keyboard-focus-visible`,
  `keyboard-activation`), and collected the visible text. Findings were kept once per rule and
  scene, at the highest severity.
- Captions rules (`video-caption`, `audio-caption`) were reported but never blocked. Added the
  admin setting of VPAT exceptions, axe rule ids reported but not blocking, empty by default:
  `GET` and `PUT /api/admin/activity-quality` with `{ vpatExceptions: string[] }` (admin only,
  400 `invalid_vpat_exceptions` for anything that is not a rule id).
- The reading level used the grade band's highest grade (`prek`, `pre-k` and `pk` 0; `k` and
  `k-1` 1; `k-2` and `1-2` 2; `2-3` 3; `3-5` and `4-5` 5; `6-8` 8; `9-12` 12; otherwise the last
  number in the band) and limits for sentence length, word length and syllables that loosened
  with it. Sight words (the public-domain Dolch and Fry lists, in
  `activities/sight-words.json`) and words quoted in the acceptance criteria were never pointed
  out. It read the default language's narration scripts from the media plan (or the
  specification's audio scripts before there was one) and the text the player showed, and
  reported the Flesch-Kincaid grade for information. It was skipped, and said why, without a
  grade band, with an unknown one, for a language other than English, or with nothing to read.
- The run history and its toasts named the new run **Quality check**.
