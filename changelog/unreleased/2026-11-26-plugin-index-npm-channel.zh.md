# 已发布的插件索引恢复列出，插件市场写明来源失败的原因

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `core`, `server`, `web`

[English](2026-11-26-plugin-index-npm-channel.md)

penguin-harness-plugins [#70](https://github.com/Prism-Shadow/penguin-harness-plugins/pull/70) 为十九行条目加上 `npm` 渠道后，已发布的插件索引在所有部署上都不再列出。按索引仓库的渠道规则，该渠道即 npm registry，不带 `url`；而索引读取要求每个渠道都带 `url`，读到第一行这样的条目就整份拒绝。于是插件市场对一个其实已经访问到的来源显示「有 1 个插件来源无法访问」，无论从哪个地址读取索引都是如此；公开站点的构建也因同样的原因略过了已发布的索引。

## 细节

- 索引读取（`@prismshadow/penguin-core/plugin-index` 的 `parsePluginIndex`）不再要求每个渠道都带 `url`，只有安装时要获取的 `github` 渠道必须带。`npm` 渠道与本服务端不从中安装的其他种类渠道照原样列出；带 `url` 时它仍须是字符串。
- 被拒的条目写明文档、位置、条目自称的包与出错的字段，例如 `… has a malformed entry at index 3 (@penguinharness/action-minutes@0.2.19-rc.1): channels[1] (github) has no url`。
- 获取失败时写明 undici 那句 `fetch failed` 底下的原因：errno 或其错误码、证书被拒时的错误码，以及解析出多个地址的主机在每个地址上的失败。一个来源经多个地址（自身与镜像）尝试时，按尝试顺序列出每个地址的失败；非成功答复附带状态文字。
- 插件市场的提示改为「有 N 个插件来源读取失败」，后接文字操作「[详情]」：展开后逐个列出失败的来源地址与服务端给出的原因，原因可选中复制，后接「[报告问题]」。
