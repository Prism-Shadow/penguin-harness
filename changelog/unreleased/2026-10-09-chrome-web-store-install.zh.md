# Chrome 扩展可从 Chrome 应用商店安装

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#1006](https://github.com/Prism-Shadow/penguin-harness/pull/1006)

[English](2026-10-09-chrome-web-store-install.md)

PenguinHarness Browser 已上架 [Chrome 应用商店](https://chromewebstore.google.com/detail/penguinharness-browser/dodgfhpcbmkjfcbgnoidablfgjjhhmgp)，现在推荐从商店安装。Release 中的 zip 保留，供无法访问商店的网络使用。

- **连接你的 Chrome**的第一步先给出商店链接；其下用一行较淡的文字给出 zip 下载和开发者模式步骤，供打不开商店时使用。
- 商店版的扩展 ID 与 manifest 钉住的 key 赋予 zip 版的相同，服务器无需改动即可接受两者。Chrome 中每个 ID 只能保留一份：从 zip 改为商店安装，需要先移除已加载的那份并重新配对。
- 文档「使用你自己的 Chrome」一节和 README 改为推荐商店安装，zip 作为备选。
