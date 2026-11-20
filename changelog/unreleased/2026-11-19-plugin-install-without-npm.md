# Plugins with no dependencies install and uninstall on a machine without npm

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`

[中文版](2026-11-19-plugin-install-without-npm.zh.md)

The desktop app's server runs under Electron's utilityProcess, with no npm beside it, so installing a plugin from the market, through the published index's release channel, from a zip or a package directory, and removing one, all failed there. The installer now looks for npm before every operation. When it finds npm, npm does everything, as before. When it finds none, a package that needs nothing npm does is installed and removed by the server itself; a package that does is refused, saying why.

## Details

- A package needs npm when its version declares `dependencies`, `optionalDependencies`, `bundleDependencies` or a `peerDependencies` entry not marked optional, an install script (`preinstall`, `install`, `postinstall`, or the registry's `hasInstallScript`), or carries `binding.gyp`. A `prepare` script does not count: npm runs it only for git and directory sources. An `os` or `cpu` list that excludes the machine refuses the install, as npm's EBADPLATFORM does.
- By name: the server reads the package's abbreviated document from the registry the Plugin sources setting names (the official registry when it names none), each address followed by the mirrors the Plugin mirrors setting rewrites it into. The version follows npm's rules for tags, exact versions and `^`, `~` and x-ranges; other range forms are refused with a request to name a version. A name or version the registry does not have falls through to the published index's release channel, as npm's E404 and ETARGET do.
- Downloads are capped (a 32 MB document, a 64 MB tarball), each address has its own window, and the whole tarball or release asset is checked against its pinned sha512 before it is unpacked; an address serving other bytes hands over to the next one, and a version that pins no sha512 is refused.
- Unpacking writes regular files only. Directories, symbolic links, hard links and device files are skipped, as npm skips links; an entry that is absolute or contains `..`, a backslash or a colon refuses the whole package; a package may unpack to 256 MB and 20,000 files. The package's own package.json must be the name and version asked for.
- A zip or package directory installs the files its `files` field publishes (package.json, the README, the license and `main` always), packed by the server into the `archives/` tarball `npm pack` would have written.
- The files are staged under `<prefix>/.staging/` and swapped in by renaming the installed directory aside first; a swap that fails puts the installed version back and refuses the install. Staging older than an hour is swept at the next install. The prefix's package.json records the install as npm would (`^<version>`, the range asked for, the release URL, or `file:archives/<tarball>`), and npm's hidden lockfile is removed so a later npm run reads the tree from disk.
- Removal without npm takes the directory and its package.json entry away and prunes tarballs nothing names any more.
- A package that needs npm, on a machine without it, is refused with its dependencies or scripts, where npm was looked for, and "Install Node.js, which includes npm (https://nodejs.org), then restart PenguinHarness so it finds npm." A link (a git repository or an https tarball) still needs npm. Failures that did not come from npm no longer start with `npm:`, and a package the route takes back out after an install without npm is not said to have run install scripts.
- A machine where npm was not found looks again at the next operation instead of keeping the answer until a restart.
