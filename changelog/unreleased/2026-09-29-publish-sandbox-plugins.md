# The sandbox backends are published to npm

- **Date:** 2026-09-29
- **Type:** process
- **Scope:** `plugins`, `release`, `ci`, `tooling`
- **PR:** [#923](https://github.com/Prism-Shadow/penguin-harness/pull/923)

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
- The release pre-flight (`scripts/check-publishable.mjs`) now also fails when a published
  package depends on a private plugin, not only on a private package.
- The release reference gains the procedure for the first publish of a new name. Before the next
  tag, a maintainer publishes the four backends once by hand, then configures each of them as a Trusted Publisher.
