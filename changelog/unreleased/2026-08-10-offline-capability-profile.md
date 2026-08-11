# Offline capability profile

Penguin now has a separate offline capability profile for every native release target: Linux and macOS x64/arm64, and Windows x64. It provides deterministic DOCX inspection/basic editing, PPTX inspection/slide append, and PDF inspection/merge in fully offline deployments, while standard releases and npm packages remain lightweight. Future capabilities extend this profile rather than creating product-specific Harness variants.

## Complete Skill resources

Library Skill installation now copies every regular file in the Skill directory recursively instead of installing only `SKILL.md` and `icon.svg`. Reinstallation replaces the directory atomically, so bundled scripts and lockfiles are available without leaving stale resources behind.

## Offline dependencies and controlled environment

Each platform-specific offline bundle adds the `word-docx`, `powerpoint-pptx`, and `pdf-tools` Skills, their fixed helpers, and one deduplicated wheelhouse for CPython 3.9–3.13 on that target. On first use, a shared bootstrap installs only that Skill's locked dependencies into its own Agent-owned `shared_env/<skill>` virtual environment without network access or system Python changes. A compatible system Python with `venv` remains a prerequisite; Linux requires glibc 2.17 or newer and does not support musl/Alpine.

## Safe document operations

DOCX supports paragraph inspection, appending headings/paragraphs, and replacing ordinary text within a run; a missing heading style falls back to a bold ordinary paragraph. PPTX supports slide-text inspection and appending one title-and-body slide. PDF supports page/text inspection and ordered merging of existing, unencrypted files. Every write uses distinct input/output paths, refuses an existing output, reopens and validates the result, and confirms that all sources remain unchanged. The release workflow validates every target and runs all three helpers in Docker with networking disabled across Python 3.9–3.13.

On POSIX systems, `penguin update` detects the installed `lib/offline/profile.json` marker and keeps selecting the same offline profile, so updates do not silently replace it with a standard package. Windows in-place update remains unsupported and prints the manual command instead.

The POSIX installer accepts `--offline`; Windows accepts `-Offline`. The default commands still select standard packages. The profile flag selects the matching native artifact and is rejected when combined with a universal or explicit local archive.
