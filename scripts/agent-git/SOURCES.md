# Agent State Git

Agent State runs the local Git plumbing from [GitHub Desktop's dugite-native 2.56.1](https://github.com/desktop/dugite-native/tree/v2.56.1). The upstream archives and SHA-256 checksums are pinned in [dugite 3.3.3](https://github.com/desktop/dugite/blob/v3.3.3/script/embedded-git.json).

Git is distributed under GPL-2.0-only. Its license accompanies the program in COPYING. The program is distributed without warranty.

* [Corresponding Git source](https://github.com/git/git/tree/03b41523c576f26ad34085378717a0c1b287470f)
* [GitHub Desktop build scripts and dependency sources](https://github.com/desktop/dugite-native/tree/v2.56.1)
* [Git for Windows corresponding source archive](https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/mingw-w64-git-2.56.1.1-1.src.tar.gz)
* [Git for Windows source](https://github.com/git-for-windows/git/tree/v2.56.1.windows.1)
* [Git for Windows SDK packages, sources and build recipes](https://github.com/git-for-windows/git-sdk-64/tree/main/usr/share/doc)

The Windows binaries also include the libraries needed to start git.exe. Their original license notices accompany each Windows build under share/licenses. Agent State uses Git’s built-in local object and reference operations.
