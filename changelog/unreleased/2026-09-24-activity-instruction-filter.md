# Audios sorts narration into main instructions and scaffolding

- **Date:** 2026-09-24
- **Type:** feat
- **Scope:** `web`

The Audios section can now narrow its narration list to **main instructions**, the lines
that tell the learner what to do ("Tap the rock", "Select the date", "Press and hold"),
or to **scaffolding**, the hints, retries and corrections ("Not quite, try again"). A
reviewer can check every instruction, or every corrective line, in one pass without
opening scenes.

- A second chip row, **Instruction**, offers All, Main instructions and Scaffolding with
  counts. It combines with the existing state filter: each row's counts are taken within
  the other row's choice, so a count always matches the lines its chip shows.
- Each main instruction or scaffolding line carries a badge naming its type. Lines that
  are neither, and all music and sound effects, stay listed under All.
- The type is worked out from each line's key, description and script with the same
  keyword rules Loom used, so an imported activity sorts the same way. Nothing new is
  stored; editing a script re-sorts its line straight away. In a translation, each line
  is sorted by its default-language script, so it keeps one type in every language, even
  before it is translated.
- Generating missing speech still acts on every narration the language needs, whatever
  the filters show.
