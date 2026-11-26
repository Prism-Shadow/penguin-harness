# The published plugin index lists again, and the market says why a source failed

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `core`, `server`, `web`

[中文版](2026-11-26-plugin-index-npm-channel.zh.md)

The published plugin index stopped listing on every deployment once penguin-harness-plugins [#70](https://github.com/Prism-Shadow/penguin-harness-plugins/pull/70) added an `npm` channel to nineteen rows. That channel names the npm registry and carries no `url`, as the index repository's channel rules state, but the index reader required a `url` on every channel and refused the whole document at its first such row. The plugin market then showed 「有 1 个插件来源无法访问」 for a source it had in fact reached, whichever address the index was read from, and the website's build passed over the published index for the same reason.

## Details

- The index reader (`parsePluginIndex` in `@prismshadow/penguin-core/plugin-index`) accepted a channel without a `url` unless it was the `github` channel, the one an install fetches. An `npm` channel and a channel of a kind the server does not install from listed as written. A `url`, where present, still had to be a string.
- A refused row named the document, its position, the package it claimed to be and the field at fault, e.g. `… has a malformed entry at index 3 (@penguinharness/action-minutes@0.2.19-rc.1): channels[1] (github) has no url`.
- A failed fetch named what lay under undici's bare `fetch failed`: the errno or its code, a certificate refusal's code, and each address of a host that resolved to several. A source tried over several addresses (its own and its mirrors) reported every address's failure in order, and a non-ok answer carried its status text.
- The plugin market's notice read 「有 N 个插件来源读取失败」 and gained a 「[详情]」 text action. It listed each failed source by its address with the server's reason, as selectable text with 「[报告问题]」 after it.
