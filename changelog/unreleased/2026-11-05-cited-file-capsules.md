# Cited files read as capsules in channels and desk conversations

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `web`, `ui`
- **Issue:** [#1440](https://github.com/Prism-Shadow/penguin-harness/issues/1440)

[中文版](2026-11-05-cited-file-capsules.zh.md)

A file an employee cites in a channel message or in an organization's conversation (a desk or a ticket session) reads as a capsule with the file's name, the full path on hover, as it already did in tickets. A citation written `[Weekly submissions](<app_data_dir>/…/weekly-submissions.md)` reads as "Weekly submissions". A click still copies the path.

## Details

- CommonMark reads no link in `[label](<app_data_dir>/…)`, since a destination that opens with `<` ends at the first `>`. The capsule pass reads the citation from the text the parser left. A Markdown link whose destination is a path in the Project's data directory becomes a labelled capsule too. Every other link stays a link.
- Paths in other conversations are drawn as before.
- The UI package's `Md` takes extra remark passes and element overrides from `MdExtensionsProvider`, so a surface can reach Markdown drawn deep inside a package component.
