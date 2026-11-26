# 插件索引重新读得懂 npm 通道

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `core`, `server`

[English](2026-11-26-plugin-index-npm-channel.md)

索引格式的 Channels 一节写明：通道的 `url` 除 `kind="npm"` 外必填，npm 通道必须不带——registry 本身就是那个地址。而 `packages/core/src/plugin/index-document.ts` 的文档校验要求每个通道都带 `url`，于是发布索引里第一条带 `npm` 通道的行让整份文档被拒：server 对 Plugins 页答 `has a malformed entry at index 3`，该源的插件从列表消失，页面对一份其实已经到达的文档显示「One plugin source could not be reached」横幅。

现在通道的 `url` 可选。`kind` 仍必填，给了 `url` 仍必须是字符串；行是否装得上由安装面判断：github 通道没写地址的条目照常列出，安装时报一句 fault，不再崩。
