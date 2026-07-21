# Project Working Rules

## Design Docs

- `design/` is this project's design documentation (a symlink to the penguin-harness-design repo); `design/specs/` is the main body.
- The design docs are the ground truth: when code and design disagree, the design docs win.
- Design and code must be updated in sync: any code change that affects architecture, behavior, or interfaces must update the corresponding docs under `design/specs/`, and when a design change lands, the code must be updated to match.
- If you believe the design itself is wrong, confirm with the user and update the design docs first, then change the code — do not bypass the design and implement directly.

## Language

- English is the working language of this repository: code, comments, error/log messages, test names and fixtures, package metadata (e.g. `package.json` descriptions), and developer docs are written in English.
- Chinese appears only where it is the required content itself:
  - i18n catalogs and fields: the zh dictionaries (`packages/*/src/lib/strings.ts`, `packages/cli/src/i18n.ts`), `titleZh` values, `short_description_zh` in SKILL.md frontmatter, the `中文` language label, and `*.zh.md` documents (`README.zh.md`, docs/blog translations).
  - The design docs under `design/` (specs are written in Chinese by default).
  - Test literals that must match zh i18n output (e.g. e2e assertions against the zh-locale UI) or that exercise CJK-specific behavior (display width, CJK id validation, language detection) — such fixtures are load-bearing; the comments around them are still English.
- Any other Chinese in the repo is residue: translate it to English when you touch it, and do not introduce new Chinese outside the cases above.

## Changelog

- `changelog/` records every update in English, grouped by release version. For every change you make, add an entry file `changelog/<version>/YYYY-MM-DD-<semantic-id>.md` (date first, then a short kebab-case semantic id), where `<version>` is the next unreleased version — if the latest release tag is vX.Y.Z, entries go in the following version's folder (e.g. v0.0.1 released → entries go in `0.0.2/`). Released versions' folders are frozen. Related changes may share one entry file (extend its details) instead of opening a new file per small change.
- Entry format: an H1 title, then a one-sentence summary paragraph, then details.
- Every new entry must also be added to its version folder's index `changelog/<version>/README.md`, as a link with the entry's title followed by its one-sentence summary — keep that README in sync with the folder's entry files. The top-level `changelog/README.md` documents only the layout.
