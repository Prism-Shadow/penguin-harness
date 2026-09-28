# Build readiness checks the assessment and shared media keys

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

The Build stage's checklist now says, before an author assembles, when an assessed activity has
no assessment or its assessment breaks the rules an edit is held to (a single-choice item with
two correct answers, a repeated id, a title that does not name its file). A missing assessment,
or a problem an author's edit added, holds back Assemble until it is fixed; a problem the
module's own assessment file already had is only a warning. The checklist also warns when one
media key is described differently in different scenes, for example `welcome` as a sound in one
scene and as a picture in another, which the media plan would otherwise refuse.
