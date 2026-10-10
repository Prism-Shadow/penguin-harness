# Icons, status marks and actions move into the shared UI package

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-09-30-ui-migration-w1.zh.md)

The first wave of the UI package migration moved the Web App's basic components into `@prismshadow/penguin-ui`. The web copies were deleted and their importers read the package root; the package components take their copy as props and their colours from theme tokens.

## What moved

- **Icons:** the `ICONS` registry, keyed by what each glyph draws, with `GlyphIcon`, `Chevron`, the fixed-grid marks (`ChevronDown`, `CheckIcon`, `PlusIcon`, `DownloadIcon`, `UploadIcon`, `CloseIcon`) and `ICON_SIZE` / `ICON_GAP`. Feature files' copies of a shared glyph (the plus, the back arrow and chevrons, the rotate arrow, the key, the eye, the book, the clock and others) now read the registry, which gained `plus`, `key`, `keyOff`, `rotateCw`, `arrowLeft`, `chevronLeft` and `chevronRight` for them.
- **Avatars and logos:** `AgentAvatar`, `UserAvatar`, a new `AvatarStack` in place of two hand-built stacks, `ProviderLogo` and `PenguinLogo`.
- **Status and feedback:** a new `Dot`, `StatusIcon`, `ActivityIcon` (formerly `SessionActivityIcon`) with `BackgroundTasksMark` and `ScheduleMark`, `UpdateDot` and `UpdatePill`, `Badge` (tones by name, plus `variant` and `size`) with a new `Count`, `Skeleton` and `EmptyState`.
- **Actions:** `Button` (a `link` variant, `xs` / `icon-sm` sizes and `loading`), a new `IconButton`, a new `Link`, `CloseButton`, `CopyButton`, a new `Kbd` and `HiddenFileInput`.
- **Strings:** a `UiStrings` provider carries the package's own accessibility fallbacks (close, copied, loading), which the Web App supplies in the interface language.

## Details

- A web guard holds the glyph paths still typed out in feature files to a list keyed by the wave that removes them; a new one fails.
- A new theme token, `--ui-mark-new`, colours the update dot. Every theme declares it, and Primer keeps the pale red.

## Visible changes in the default theme (Primer)

- Badge and update-pill text 11 → 12 px. Badges come in soft, outline and solid weights; the former `brand` badge is neutral solid, and the "Free" badge is info (sky) instead of yellow.
- Status icons 13 → 14 px, with the running state drawn by the Spinner's arc.
- Tone inks (success, attention, danger) one step deeper in light mode.
- The unread dot emerald-500 → emerald-700, at a fixed 6 px.
- Buttons: the `secondary` ink one step darker, the `ghost` ink one step lighter, hover fills shifted one step.
- Links take the link colour token and the external-link glyph instead of "↗".
- Labels styled as buttons (the import controls) take the theme's focus outline on keyboard focus.
- Copy buttons in rows are 20 px squares.
- The close button's hover fill and ink one step lighter.
- The empty-state ink one step lighter.
- Skeletons keep their gray-200 fill, now through the line token.
- Avatar tile inks re-measured against each theme's surfaces.
