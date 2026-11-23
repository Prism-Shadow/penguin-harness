# Zip imports never inflate directory entries

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1450](https://github.com/Prism-Shadow/penguin-harness/pull/1450)

[中文版](2026-11-03-zip-directory-entry-caps.zh.md)

A zip entry whose name ends in `/` no longer cost the server memory. The Skill, plugin and Benchmark imports had let directory entries past every archive cap, and fflate still inflated whatever bytes one held into a buffer of its declared size: the Skills archive route took a 262 KB zip whose directory entry inflated to 256 MB, so the 14 MB upload cap let one request allocate about 14 GB.

## Details

- A directory entry was turned away before the caps, as the hook import already did: it was never inflated and never read, counted towards neither the file limit nor the size caps, and was never reported. Directories were still recreated from the files' paths.
- What an import accepted did not change: the zip above installed its files as before, without the 256 MB, and a zip with more directory entries than the file limit still imported.
