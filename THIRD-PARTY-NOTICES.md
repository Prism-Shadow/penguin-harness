# Third-party notices

PenguinHarness itself is licensed under Apache-2.0 (see [LICENSE](LICENSE)). Some **distributed
release artifacts** additionally bundle third-party programs, which keep their own licenses. This
file records those, and how to obtain their source.

Nothing listed here is part of this repository — the components are downloaded by the release
workflow (`.github/workflows/release.yml`) and placed alongside the application inside the
release archives. Installing from npm (`@prismshadow/penguin-cli`) bundles none of them.

## Node.js runtime — `node/`

Present in every archive except `penguin-universal.tar.gz`. Downloaded unmodified from the
official distribution at <https://nodejs.org/dist/>. Node.js is MIT-licensed with additional
notices for its dependencies; the full text ships inside the bundle
(`node/LICENSE`, and on Windows `node/LICENSE`).

Source: <https://github.com/nodejs/node> — the tag matching the bundled version, which is pinned
as `NODE_RUNTIME_VERSION` in the release workflow.

## MinGit (Git for Windows) — `git/`

Present in `penguin-win32-x64.zip` only.

The Windows package bundles **MinGit**, the minimal redistributable build of Git for Windows,
unmodified, as published by the Git for Windows project. It supplies the POSIX shell that the
agent's `exec_command` runs (`git/usr/bin/sh.exe`, which is GNU bash), roughly sixty core
utilities, and `git.exe`. It is used only when the machine has no Git for Windows installation of
its own; a user-installed one always takes precedence.

**License: GNU General Public License version 2** (with the additional per-component licenses
that Git for Windows ships). The complete license texts are included inside the bundle at
`git/LICENSE.txt` and `git/mingw64/share/licenses/`.

Version bundled: the release attached to the Git for Windows tag pinned as `MINGIT_TAG` in the
release workflow.

**Written offer / source availability.** The complete corresponding source code for the bundled
MinGit is published by the Git for Windows project at:

- <https://github.com/git-for-windows/git> — repository, tagged per release
- <https://github.com/git-for-windows/git/releases> — release assets, including the source
  archives for each tag

The bundled binaries are byte-identical to the `MinGit-<version>-64-bit.zip` asset of that tag;
no patches are applied. If you need the corresponding source and cannot obtain it from the URLs
above, open an issue on this repository and we will provide it.

## Offline word-docx wheels — `lib/offline/word-docx/wheels/`

Present only in `penguin-word-docx-linux-x64.tar.gz`; standard Release and npm artifacts do not
include these files. The enhanced bundle carries unmodified Python wheels for `python-docx`
(MIT), `lxml` (BSD-3-Clause), and `typing_extensions` (PSF-2.0), at the versions and SHA256
hashes pinned in `packages/skills/offline/word-docx/requirements.lock`. Each wheel retains its
license text under its `.dist-info/licenses/` directory.

Sources: <https://github.com/python-openxml/python-docx>, <https://github.com/lxml/lxml>, and
<https://github.com/python/typing_extensions>.
