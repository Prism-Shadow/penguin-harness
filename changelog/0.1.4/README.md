# Version 0.1.4

Released on 2026-07-27.

- [2026-07-27] Release pipeline: the server's version-endpoint test asserted a literal `buildDate: null`, which can only fail in the one job that stamps `BUILD_DATE` — the npm publish. v0.1.3's GitHub Release shipped complete while `@prismshadow/penguin-{skills,core,server,cli}` stayed at 0.1.2 on the registry; the assertion now compares against core's constant, so a stamped release build passes too. ([details](2026-07-27-release-pipeline.md))

- [2026-07-27] Sites: blog images move to the sibling community repo — post bodies keep the portable `/blog-assets/<name>` path and the renderer resolves it to the hosted URL, so a clone no longer carries screenshots only the marketing site renders, and the two capture scripts now stage their output in the gitignored `packages/landing/.blog-assets/`. ([details](2026-07-27-sites-and-blog.md))
