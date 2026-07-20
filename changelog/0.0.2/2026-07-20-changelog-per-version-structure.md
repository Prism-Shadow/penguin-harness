# Reorganize the changelog by release version

The top level now holds only version folders; each version's README carries the
one-line-per-change index, and detail files live inside the folder (mirrors agenthub PR
#162).

## Details

- `changelog/<version>/README.md` is the release summary: one line per change with its
  title and one-sentence summary, linking the detail file relatively; `0.0.2/README.md`
  absorbs the section previously kept in the top-level index.
- `changelog/README.md` now documents only the layout and the entry conventions (no
  per-file listing).
- The working rules (AGENTS.md, CONTRIBUTING.md) point index updates at the version
  folder's README instead of the top-level file.
