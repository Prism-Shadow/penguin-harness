# Offline capability profile (initial word-docx support)

Penguin now has a separate offline capability profile for every native release target: Linux and macOS x64/arm64, and Windows x64. The initial profile provides deterministic DOCX inspection and basic editing in fully offline deployments, while standard releases and npm packages remain lightweight. Future PPTX, PDF and other Skills extend this profile rather than creating product-specific Harness variants.

## Complete Skill resources

Library Skill installation now copies every regular file in the Skill directory recursively instead of installing only `SKILL.md` and `icon.svg`. Reinstallation replaces the directory atomically, so bundled scripts and lockfiles are available without leaving stale resources behind.

## Offline dependencies and controlled environment

Each platform-specific offline bundle adds the `word-docx` Skill, its fixed helper scripts, and hash-locked wheels for CPython 3.9–3.13 on that target. On first use, the bootstrap installs those wheels without network access into the Agent-owned `shared_env/word-docx` virtual environment; it does not modify the system Python environment. A compatible system Python with `venv` remains a prerequisite; Linux requires glibc 2.17 or newer and does not support musl/Alpine.

## Safe basic editing

The first release supports paragraph inspection, appending headings and paragraphs, and replacing ordinary text within a run. A document without a requested built-in heading style falls back to a bold ordinary paragraph. Editing always uses distinct input and output paths, refuses to overwrite an existing output, reopens the generated DOCX, verifies the requested content, and confirms that the source file did not change. The release workflow validates the separate artifact and runs its acceptance test in Docker with networking disabled.

`penguin update` detects the installed `lib/offline/profile.json` marker and keeps selecting the same offline profile, so updates do not silently replace it with a standard package.

The POSIX installer accepts `--offline`; Windows accepts `-Offline`. The default commands still select standard packages. The profile flag selects the matching native artifact and is rejected when combined with a universal or explicit local archive.
