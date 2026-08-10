# Offline word-docx release bundle

Penguin now has a separate Linux x64 release bundle for deterministic DOCX inspection and basic editing in fully offline deployments, while the standard release and npm packages remain lightweight.

## Complete Skill resources

Library Skill installation now copies every regular file in the Skill directory recursively instead of installing only `SKILL.md` and `icon.svg`. Reinstallation replaces the directory atomically, so bundled scripts and lockfiles are available without leaving stale resources behind.

## Offline dependencies and controlled environment

The enhanced bundle adds the `word-docx` Skill, its fixed helper scripts, and hash-locked wheels for CPython 3.9–3.13 on Linux x64. On first use, the bootstrap installs those wheels without network access into the Agent-owned `shared_env/word-docx` virtual environment; it does not modify the system Python environment. A compatible system Python with `venv` remains a prerequisite.

## Safe basic editing

The first release supports paragraph inspection, appending headings and paragraphs, and replacing ordinary text within a run. A document without a requested built-in heading style falls back to a bold ordinary paragraph. Editing always uses distinct input and output paths, refuses to overwrite an existing output, reopens the generated DOCX, verifies the requested content, and confirms that the source file did not change. The release workflow validates the separate artifact and runs its acceptance test in Docker with networking disabled.

Because the standard updater cannot yet select the enhanced artifact, `penguin update` now detects an installed word-docx bundle and refuses the automatic replacement with a clear manual-update instruction instead of silently removing the offline resources.
