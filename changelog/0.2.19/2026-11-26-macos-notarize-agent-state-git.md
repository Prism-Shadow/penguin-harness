# The macOS desktop app ships its native Git signed, so the app notarizes

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `desktop`, `plugins`, `ci`
- **PR:** [#1879](https://github.com/Prism-Shadow/penguin-harness/pull/1879)

[中文版](2026-11-26-macos-notarize-agent-state-git.zh.md)

The macOS desktop build now carries the Agent State Git plugin's Git for its own architecture as files signed with the app, instead of inside a tar archive. Apple's notary service reads inside archives and had rejected the first signed build that contained the plugin, because the Git programs in its macOS archives carried no Developer ID signature, no secure timestamp and no hardened runtime.

## Details

- A packaging step unpacked `dist/native/darwin-<arch>.tar` of the plugin into `dist/native/darwin-<arch>/` before the app was signed, so `bin/git` was signed with the rest of the bundle. It removed the macOS Git archives from both copies of the plugin in the app: the one the server loads, and the library copy, which had carried the build host's archive unused.
- The plugin ran a payload shipped as files from where it lay, and extracted the archive into the Agent State engine cache only when there was none. The npm package, the CLI and server installers, and the Linux and Windows desktop apps kept the archives and the extraction.
- The archives for other platforms and the Git source archives in the macOS app were left as published.
- The signed macOS build saved and read back a version with the signed Git of the runner's architecture before uploading its installers, and asked the other architecture's Git for its version.
