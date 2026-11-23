# Native Git notices

The PenguinHarness plugin adapter is Apache-2.0. Git is licensed under GPL-2.0-only, with the exceptions stated in Git’s COPYING. These programs are shipped and invoked as separate executables.

The native payloads come from [dugite-native v2.56.1](https://github.com/desktop/dugite-native/releases/tag/v2.56.1), pinned by dugite 3.3.3. Linux and macOS use Git 2.56.1. Windows uses Git for Windows 2.56.1.windows.1 from MinGit. The packaged `dist/sources/` directory contains Git's source, Git for Windows' source package and the build scripts for these binaries. Their original license texts are included in those archives.

Windows payloads include libiconv, GNU libintl, PCRE2 and zlib. The 32-bit build also uses libgcc and winpthreads. Each Windows payload retains its upstream license notices and package version list. The corresponding MSYS2 sources for libiconv, gettext, PCRE2 and zlib accompany the Git sources. The complete source archive accompanying the PenguinHarness Release also provides the 32-bit toolchain runtime sources. GNU libgcc's runtime library exception is preserved with its license.

Linux requires the host’s glibc and zlib, and macOS uses its system libraries. The plugin does not ship these system libraries.
