# The skill-library loader keeps non-text files out of the manifest

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `skills`

[中文版](2026-08-23-skill-library-loader-keeps-non-text-files-out.zh.md)

`readSkillFiles` collected every regular file in a library skill directory by reading it with the
`utf8` encoding, and `installSkill` writes those strings back with the same encoding — so a file
that was not UTF-8 text would have had its bytes replaced with U+FFFD on the way through and been
installed corrupted, with nothing reporting it. Auxiliary files are now decoded strictly and
skipped when they are not text, and a test asserts the whole library stays text.

## Details

- `decodeSkillFile` decodes with a `fatal` `TextDecoder` and rejects a NUL byte, which is what
  UTF-16 text looks like once its bytes happen to form valid UTF-8. `ignoreBOM` keeps a leading BOM
  in the string, so a file that decodes carries exactly the content the previous read produced.
- The new library-wide test walks `skills/` — `SKILL.md` and `icon.svg` included, not just the
  auxiliary files — and names any file that is not text, so one cannot reach a release unnoticed.
- The manifest stays text-only by design: the archive-install route carries uploaded files as
  `Uint8Array` and is unaffected, so a Skill installed from a zip can still ship binary assets.
