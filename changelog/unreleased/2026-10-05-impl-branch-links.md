# A proposal's impl branch opens on GitHub

- **Date:** 2026-10-05
- **Type:** feature
- **Scope:** `company-proposals`, `server`, `web`

[中文版](2026-10-05-impl-branch-links.zh.md)

The head and base of a registered impl branch were plain text on the proposal page; a reviewer had to find the branch in the repository by hand.

## Changes

- The proposal views' `impl.head` and `impl.base` each carry `url`, the branch's page on GitHub (`https://github.com/<owner>/<repo>/tree/<branch>`), or `unresolved`, the reason there is none. A side written as `owner/repo` is used as written; a remote name is looked up in the plugin's `origins` setting first, then among the shared workspace's GitHub remotes (as registration read them). Only GitHub remotes count, over https or ssh. The registered impl is unchanged: the link is computed for each read, without running git.
- The proposal page's Implementation section renders each side with a page as a link that opens in a new tab, and each side without one as text whose tooltip gives the reason. The PR link is unchanged.
