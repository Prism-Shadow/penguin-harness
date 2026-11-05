# 官网首页与应用画同一个智能体

- **Date:** 2026-09-01
- **Type:** fix
- **Scope:** `landing`, `web`
- **PR:** [#579](https://github.com/Prism-Shadow/penguin-harness/pull/579)

[English](2026-09-01-landing-agent-glyph.md)

官网的 `BotIcon` 改为与 Web App 的智能体字形完全一致——眼睛和笑嘴都在。两边本来就是同一个
lucide 机器人，直到应用那边加上了五官（[#538](https://github.com/Prism-Shadow/penguin-harness/pull/538)）；
售卖这个产品的页面不该把产品的核心对象画成第二种样子。

## 细节

- 这个字形有意存在两份：官网刻意不引入任何图标依赖，两边没有可共用的模块。现在两边都是单个
  `<path>`，因此是字面上完全相同的一串。
- `packages/landing/test/agent-glyph-sync.test.ts` 以文本方式读取两处来源，只动其中一处就会失
  败——这个字形已经漂移过一次（新对话页示例文件夹里那份手抄的字面量），没人核对的副本必然会有
  下一次。
- 只有智能体这一枚不一致。官网图标集里的 history、users、clock 本来就与应用是同一套画法。
