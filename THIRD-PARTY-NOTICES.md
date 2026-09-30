# Third-party notices

PenguinHarness itself is licensed under Apache-2.0 (see [LICENSE](LICENSE)). Some **distributed
release artifacts** additionally bundle third-party programs and files, which keep their own
licenses. This file records those, and how to obtain their source.

Nothing listed here is covered by this repository's Apache-2.0 license, not even the MiSans font
files committed to it under `packages/ui/src/fonts/misans/`. The programs below are downloaded by
the release workflow (`.github/workflows/release.yml`) and placed alongside the application inside
the release archives. The fonts are part of the built web assets: the build takes the MiSans files
from this repository and copies every other font out of an npm dependency. The web assets ship
wherever the Web App does, and that includes npm: `@prismshadow/penguin-cli` depends on
`@prismshadow/penguin-server`, whose package carries them as `web-dist/`. Installing from npm
therefore bundles the fonts, but neither program.

What earns an entry is a third-party work redistributed **as its own file**. An npm package whose
JavaScript is compiled and minified into the application bundle (React, Shiki, xterm.js, KaTeX's own
code, ...) is not listed: its license travels with it in `node_modules` and in the lockfile, and
repeating every one of them here would be a second, staler copy of `pnpm-lock.yaml`.

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

## KaTeX fonts — `KaTeX_*.woff2` in the web assets

Present wherever the Web App ships: every release archive, the desktop application, the assets the
server serves, and the npm server package's `web-dist/`.

Math rendering uses [KaTeX](https://katex.org), whose typefaces are separate font files rather than
code. The web build copies them unmodified out of the `katex` npm package into the application's
asset directory, where the browser fetches them by URL; bundling them locally is what lets the
desktop application render formulas with no network. Only the woff2 format is copied — the woff and
truetype fallbacks KaTeX also ships are dropped at build time (`dropNonWoff2FontSources` in
`packages/web/vite.config.ts`).

**License: MIT**, the same license as the rest of KaTeX. The full text ships inside the package, at
`node_modules/katex/LICENSE`.

Source: <https://github.com/KaTeX/KaTeX> — the tag matching the `katex` version resolved in
`pnpm-lock.yaml`. The font sources and the script that builds them live in that repository.

## Mona Sans fonts — `mona-sans-*.woff2` in the web assets

Present wherever the Web App ships: every release archive, the desktop application, the assets the
server serves, and the npm server package's `web-dist/`.

Mona Sans Variable, latin and latin-ext. The web build copies the files unmodified out of the
`@fontsource-variable/mona-sans` npm package.

**License: SIL Open Font License 1.1.** The full text ships in every build as
`fonts-licenses/mona-sans.txt`, mirrored from the package's `LICENSE` into
`packages/ui/src/fonts/LICENSES/mona-sans.txt`.

Source: <https://fontsource.org/fonts/mona-sans> — the `@fontsource-variable/mona-sans` version
resolved in `pnpm-lock.yaml`.

## JetBrains Mono fonts — `jetbrains-mono-*.woff2` in the web assets

Present wherever the Web App ships: every release archive, the desktop application, the assets the
server serves, and the npm server package's `web-dist/`.

JetBrains Mono Variable, latin and latin-ext. The web build copies the files unmodified out of the
`@fontsource-variable/jetbrains-mono` npm package.

**License: SIL Open Font License 1.1.** The full text ships in every build as
`fonts-licenses/jetbrains-mono.txt`, mirrored from the package's `LICENSE` into
`packages/ui/src/fonts/LICENSES/jetbrains-mono.txt`.

Source: <https://fontsource.org/fonts/jetbrains-mono> — the `@fontsource-variable/jetbrains-mono`
version resolved in `pnpm-lock.yaml`.

## IBM Plex Sans fonts — `ibm-plex-sans-latin*.woff2` in the web assets

Present wherever the Web App ships: every release archive, the desktop application, the assets the
server serves, and the npm server package's `web-dist/`.

IBM Plex Sans Variable, latin and latin-ext. The web build copies the files unmodified out of the
`@fontsource-variable/ibm-plex-sans` npm package.

**License: SIL Open Font License 1.1.** The full text ships in every build as
`fonts-licenses/ibm-plex-sans.txt`, mirrored from the package's `LICENSE` into
`packages/ui/src/fonts/LICENSES/ibm-plex-sans.txt`.

Source: <https://fontsource.org/fonts/ibm-plex-sans> — the `@fontsource-variable/ibm-plex-sans`
version resolved in `pnpm-lock.yaml`.

## IBM Plex Sans Condensed fonts — `ibm-plex-sans-condensed-*.woff2` in the web assets

Present wherever the Web App ships: every release archive, the desktop application, the assets the
server serves, and the npm server package's `web-dist/`.

IBM Plex Sans Condensed at weight 600, latin and latin-ext. The web build copies the files
unmodified out of the `@fontsource/ibm-plex-sans-condensed` npm package.

**License: SIL Open Font License 1.1.** The full text ships in every build as
`fonts-licenses/ibm-plex-sans-condensed.txt`, mirrored from the package's `LICENSE` into
`packages/ui/src/fonts/LICENSES/ibm-plex-sans-condensed.txt`.

Source: <https://fontsource.org/fonts/ibm-plex-sans-condensed> — the
`@fontsource/ibm-plex-sans-condensed` version resolved in `pnpm-lock.yaml`.

## Commit Mono fonts — `commit-mono-*.woff2` in the web assets

Present wherever the Web App ships: every release archive, the desktop application, the assets the
server serves, and the npm server package's `web-dist/`.

Commit Mono at weights 400 and 700, one latin file each. The web build copies the files unmodified
out of the `@fontsource/commit-mono` npm package.

**License: SIL Open Font License 1.1.** The full text ships in every build as
`fonts-licenses/commit-mono.txt`, mirrored from the package's `LICENSE` into
`packages/ui/src/fonts/LICENSES/commit-mono.txt`.

Source: <https://fontsource.org/fonts/commit-mono> — the `@fontsource/commit-mono` version resolved
in `pnpm-lock.yaml`.

## Noto Sans SC fonts — `noto-sans-sc-*.woff2` in the web assets

Present wherever the Web App ships: every release archive, the desktop application, the assets the
server serves, and the npm server package's `web-dist/`.

Noto Sans SC Variable, as the 101 `unicode-range` slices of the package's own stylesheet. The web
build copies the files unmodified out of the `@fontsource-variable/noto-sans-sc` npm package.

**License: SIL Open Font License 1.1.** The full text ships in every build as
`fonts-licenses/noto-sans-sc.txt`, mirrored from the package's `LICENSE` into
`packages/ui/src/fonts/LICENSES/noto-sans-sc.txt`.

Source: <https://fontsource.org/fonts/noto-sans-sc> — the `@fontsource-variable/noto-sans-sc`
version resolved in `pnpm-lock.yaml`.

## MiSans fonts — `misans-*.woff2` in the web assets

Present wherever the Web App ships: every release archive, the desktop application, the assets the
server serves, and the npm server package's `web-dist/`. The files are also committed to this
repository, under `packages/ui/src/fonts/misans/`.

[MiSans](https://hyperos.mi.com/font/) is a typeface licensed by Xiaomi Inc. (小米科技有限责任公司).
The Frost theme sets its Latin and Chinese text in MiSans Regular (400) and Medium (500), and only a
browser showing that theme loads them. `packages/ui/scripts/build-misans.py` subsets the two faces
from Xiaomi's official package into `unicode-range` WOFF2 slices: glyph outlines, metrics, OpenType
features and name records are kept, the tables that index glyphs are rebuilt for each slice's
smaller glyph set, and the DSIG table is dropped. The slices are distributed only as part of the
application, in its source tree, its builds and its npm package, and are never offered on their
own. The application states that it uses MiSans in a credit line at the end of the Web App's
account menu (condition 1 of the Agreement).

Every slice keeps the copyright notice of the font files:

Copyright © 2020-2025 Beijing Xiaomi Mobile Software Co.,Ltd. All Rights Reserved.

**License: MiSans Font Intellectual Property License Agreement (MiSans 字体知识产权许可协议).** The
full text, in Chinese and English, ships beside the fonts in every build as
`fonts-licenses/misans.txt`, so every copy keeps both the copyright notice and the Agreement
(condition 4). The canonical copy of the text is `packages/ui/src/fonts/LICENSES/misans.txt`,
transcribed from the licensor's PDF; the text below repeats it, and the two must be updated
together.

<details>
<summary>Full text</summary>

MiSans字体知识产权许可协议

MiSans Font Intellectual Property License Agreement

用户须知：

User Notes:

本《MiSans字体知识产权许可协议》（以下简称“协议”）是您与小米科技有限责任公司（以下简称“小米”或“许可方”）之间有关安装、使用MiSans字体（以下简称“MiSans”或“MiSans字体”）的法律协议。您在使用MiSans的所有或任何部分前，应接受本协议中规定的所有条款和条件。安装、使用MiSans的行为表示您同意接受本协议所有条款的约束。否则，请不要安装和/或使用MiSans，并应立即销毁和删除所有 MiSans 字体包。

The MiSans Font Intellectual Property License Agreement (hereinafter referred to as the “Agreement”) is a legal agreement between You and Xiaomi Inc. (hereinafter referred to as “Xiaomi” or “Licensor”) regarding the installation and use of MiSans fonts (hereinafter referred to “MiSans” or “MiSans Fonts”). You shall accept all of the terms and conditions in the Agreement before using all or any part of MiSans. By installing and using MiSans, You agree to be bound by all of the terms of this Agreement. Otherwise, You shall not install and/or use MiSans, and shall immediately destroy and delete all MiSans font packages.

1．定义

1\. Definition

1.1 “MiSans字体”代表许可方在本协议项下提供并明确标记为“MiSans”的字体软件，包括但不限于以各种形式、格式及媒介存在的源代码、数据库、文档等。

1.1 “MiSans Fonts” refers to the font software clearly marked as “MiSans” that is provided by Licensor under this Agreement, including but not limited to source code, database, and documentation in various forms, formats, and media.

1.2 “用户”或“您”代表行使本协议授予许可的自然人、法人或非法人组织。用户应依照本协议安装、使用MiSans。

1.2 The term “User” or “You” represents the natural person, legal person, or unincorporated organization exercising the license granted in this Agreement. The User shall install and use MiSans according to this Agreement.

1.3 “使用”是指安装、下载、复制、展览或以其他方式通过利用MiSans而获益的行为。

1.3 “Use” refers to the act of installing, downloading, copying, exhibiting, or otherwise benefiting from the use of MiSans.

2．授权许可

2\. Authorization and Permission

根据本协议的条款和条件，许可方在此授予您一份不可转让的、非独占的、免版税的、可撤销的、全球性的版权许可，使您依照本协议约定使用MiSans字体，前提是符合下列条件：

According to the terms and conditions of this Agreement, Licensor hereby grants You a non-transferable, non-exclusive, royalty-free, revocable, and global copyright license to use the MiSans fonts in accordance with this Agreement, provided that the following conditions are met:

1） 您应在软件中特别注明使用了 MiSans 字体。

1\) You shall specifically indicate in the Software that You are using MiSans fonts.

2）您不得对 MiSans 字体或其任何单独组件进行改编或二次开发。

2\) You shall not adapt or redevelop MiSans fonts or any of their individual components.

3）您不得单独将MiSans 字体或其组件对外租赁、再许可、给予、出借或进一步分发字体软件或其任何副本以及重新分发或售卖。此限制不适用于您使用 MiSans 字体创作的任何其他作品。如您使用 MiSans 字体创作宣传素材、logo、应用App等，您有权分发或出售该作品。

3\) You shall not individually rent, sublicense, give, loan, or further distribute the MiSans fonts or their components, or any copies thereof, nor shall you redistribute or sell them. This restriction does not apply to any other work that You create using MiSans fonts. For example, if You use MiSans fonts to create promotional materials, logos, applications (Apps), etc., You shall have the right to distribute or sell that work.

4）您应在 MiSans 字体的任何副本中保留版权声明和本协议。

4\) You shall retain the copyright notice and this Agreement in any copies of MiSans fonts.

5）不可将 MiSans 字体用于任何违法用途。

(5) You shall not use MiSans fonts for any illegal purposes.

3．知识产权

3\. Intellectual Property Rights

MiSans字体软件及其所包含的字体以及小米授权您制作的任何副本均为小米的知识产品，本字库软件的结构、组织和代码以及与本字库软件相关的所有信息均为小米的商业秘密。本字库软件及其所包含的字体受《中华人民共和国著作权法》、《计算机软件保护条例》和其他知识产权法律法规及国际公约、条约的保护。除本协议中明确的许可，小米不授予您对MiSans相关的其他知识产权权利。

MiSans Font Software and the fonts contained therein and any copies that Xiaomi authorizes You to make are the intellectual products of Xiaomi, and the structure, organization, and code of this font software and all information related to this font software are the trade secrets of Xiaomi. This font software and the fonts contained therein are protected by the Copyright Law of the People’s Republic of China, the Regulations on the Protection of Computer Software, and other intellectual property laws and regulations as well as international conventions and treaties. Xiaomi does not grant You any other intellectual property rights related to MiSans except those expressly granted in this Agreement.

4．免责声明

4\. Disclaimer

4.1 MiSans是按“原样”提供的。许可方不对本协议作出任何明示、暗示或依照法令的担保，包括但不限于对适销性、所有权、就某一用途的适用性或不侵犯版权、专利、商标或其他权利的保证。

4.1 MiSans is provided “as is”. The Licensor makes no express, implied, or statutory warranties with respect to this Agreement, including, but not limited to, warranties of merchantability, ownership, fitness for a particular purpose, or non-infringement of copyrights, patents, trademarks, or other rights.

4.2 在任何情况下，许可方及其关联公司均不对任何直接、间接、特殊、附带或间接的损害(包括但不限于购买替代商品或服务)负责。无论根据合同理论、侵权行为(包括过失)理论、严格责任理论或其他法律理论，因使用或无法使用 MiSans 字体，即使许可方及其关联公司已被告知存在这种损害的可能性，而导致的任何方式的业务中断，使用数据或利润的损失，许可方及其关联公司不承担任何责任。

4.2 In no event shall Licensor and its affiliates be liable for any direct, indirect, special, incidental, or consequential damages (including, but not limited to, the purchase of substitute goods or services). Whether under the contract theory, the tort (including negligence) theory, the strict liability theory, or other legal theories, Licensor and its affiliates shall not be liable for any form of business interruption, or loss of service data or profits resulting from the use of or inability to use MiSans fonts, even if Licensor and its affiliates have been advised of the possibility of such damages.

4.3 您需明确承担使用 MiSans 字体的所有责任和风险。如果无法证明 MiSans 有任何缺陷，您将承担所有必要的服务，修复或纠正的全部费用。

4.3 You shall expressly assume all responsibility and risk for using MiSans fonts. If it cannot be proven that MiSans is subject to any defect, You shall be responsible for all necessary services, repairs, or rectifications at full cost.

5．许可终止。

5\. License Termination

一旦您违反本协议的条款，小米随时可能终止本协议、收回授权，并要求您承担相应法律责任。

If You violate the terms of this Agreement, Xiaomi may terminate the Agreement, withdraw the license, and hold You liable for the corresponding legal responsibility at any time.

6．适用法律与管辖。

6\. Applicable Laws and Jurisdiction

本协议适用中华人民共和国的法律。如您与小米就本协议的相关问题发生争议，您与小米均有权向北京市海淀区人民法院提起诉讼。

The Agreement shall be governed by the laws of the People’s Republic of China. In case of any dispute between You and Xiaomi regarding this Agreement, both You and Xiaomi shall have the right to file a lawsuit at Beijing Haidian District People’s Court.

7．一般规定。

7\. General Provisions

7.1 本协议是小米与您之间有关MiSans软件及其所包含的字体的最新许可协议，它将取代先前所有与本字库软件相关的陈述、承诺、宣传或许可协议。

7.1 This is the most recent license agreement between Xiaomi and You regarding the MiSans Software and the fonts contained therein, and it shall supersede all prior representations, undertakings, publicity, or license agreements relating to this font software.

7.2 如果您对本协议有任何疑问或者希望获得有关字体授权许可的任何信息，请通过如下方式与小米联系：

7.2 If You have any questions regarding the Agreement or wish to learn any information regarding the licensing of the Font, please contact Xiaomi as follows:

小米科技有限责任公司

Xiaomi Inc.

地址： 北京市海淀区西二旗中路33号院小米科技园

Address: Xiaomi Campus, No. 33 Xi erqi Middle Road, Haidian District, Beijing,100085,China

邮箱：mengfanqi@xiaomi.com

Email: mengfanqi@xiaomi.com

</details>
