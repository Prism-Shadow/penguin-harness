# The sandbox backends are published to npm

- **Date:** 2026-09-29
- **Type:** process
- **Scope:** `plugins`, `release`, `ci`, `tooling`
- **PR:** [Myriad-Dreamin/penguin-harness#94](https://github.com/Myriad-Dreamin/penguin-harness/pull/94)

[中文版](2026-09-29-publish-sandbox-plugins.zh.md)

- The four sandbox backends, `@penguinharness/sandbox-{bwrap,seatbelt,wsl,dsh}`, are no longer
  private. The release publishes them to npm at the tag's version, like every other published
  plugin. Their manifests gain the fields a published package needs: public access,
  `repository` with its directory, `engines.node >=24`, and `LICENSE` among the shipped files.
- The vendored bwrap now runs from an npm install:
  - the package marks both binaries executable (`publishConfig.executableFiles`);
  - the libcap they load ships as a regular file under its versioned names, because a package
    tarball carries no symlinks.

  Before this change, an installed copy of the package had a bwrap without its exec bit, and
  without the `libcap.so.2` it links against.
- The server plugins `languages`, `claude-code`, `discord-bot`, `company-proposals` and
  `company-roadmaps` have never been published, and are now marked private. The release skips
  them, so they no longer stop a tag at the pre-flight. Every install that shipped them still
  does.
- The release pre-flight (`scripts/check-publishable.mjs`) now also fails when a published
  package depends on a private plugin, not only on a private package.
- `scripts/check-plugin-packs.mjs` packs every published code plugin, installs the tarballs with
  npm and loads them. CI's `npm packaging` job runs it.
- The release reference gains the procedure for the first publish of a new name. Before the next
  tag, a maintainer publishes the four backends and `@penguinharness/agent-company-proposals`
  once by hand, then configures each of them as a Trusted Publisher.
