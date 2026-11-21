# Computer Use carries its own version, packed once for npm and the GitHub Release

- **Date:** 2026-11-21
- **Type:** process
- **Scope:** `plugins`, `ci`, `tooling`, `docs`

[中文版](2026-11-21-computer-use-own-version.zh.md)

`@penguinharness/computer-use` left the harness's version line. Its version went from 0.2.18 to 0.1.0, which the server's embedded plugin index and the build's offline archive (`penguinharness-computer-use-0.1.0.tgz`) carry, and it moves only when the plugin changes. The plugins that keep their own version are listed in the new `scripts/lib/own-version-plugins.mjs`.

## Release

- `scripts/release-npm.sh stamp` left the listed plugins' versions alone, in their `package.json` and in the embedded index, and failed when an index row and its package disagreed.
- The release job packed each listed plugin with the new `scripts/pack-own-plugins.mjs`: two packs, one set of bytes, compared with the offline archive the builtin prefix carries. It attached that tarball to the GitHub Release.
- A new `publish-own-plugins` job published the attached tarballs to npm with provenance and skipped a version npm already had. It runs only when the repository variable `NPM_TRUSTED_PUBLISHING` is `true`. The npm chain (`publish-npm`) and its pre-flight (`check-publishable.mjs --strict`) left the listed plugins out.

## Checks

- `scripts/check-plugin-versions.mjs` required a listed plugin's `package.json` version to rise when anything it is built or packed from changed, which is everything but `test/`, `scripts/` and `vitest.config.ts`.
- CI's npm packaging job built and packed the listed plugins twice on the stamped tree, and warned when npm already had their version with other bytes.

## The package

- Its workspace devDependencies became ranges (`workspace:>=0.2.0`), so `pnpm pack` stopped writing the harness's version into the tarball.
- It gained a copy of the repository's `LICENSE`, so every channel's tarball carries it.
