# 文档站新增插件页，penguin-plugin 技能覆盖测试、分享与提交

- **Date:** 2026-11-16
- **Type:** process
- **Scope:** `docs`, `skills`
- **PR:** [#1566](https://github.com/Prism-Shadow/penguin-harness/pull/1566)

[English](2026-11-16-plugins-page-and-publish-skill.md)

「插件是什么、怎么校验、从哪来、怎么分享」的答案散在四处：字段表藏在 Skill 与插件页的深处，提交协议在另一个仓库，收录规则与测试方法则无人写下。新增的**插件**页（`packages/docs/content/plugins.{en,zh}.md`，挂在 Guides 的 Skill 与插件之后）把四块放在一起：插件是什么（一组 penguin modules——机制面由 PRFC-0001 与 PRFC-0003 承载，页面链接它们）、包的格式与两层校验（索引仓 CI 的规则、以 CONTRIBUTING 为权威；本地构建一次再按服务端自己的路径装载一次）、插件的四个来源（harness 自己的模块正由进行中的模块重组 PR 归组；随仓 `plugins/` 树发货的 builtin；收录进第三方插件索引的；以及自己的或未收录的——从 npm 安装或用 `penguin plugin link` 链接本机目录）、以及经这四条路的分享方式。

`agent-development` 插件的 `penguin-plugin` 技能——此前只讲 workbench——现在为 harness 会话承载同一片地面：开头一节 References（插件页、Skill 与插件页、服务端启动、索引仓），如何在独立实例上测试一个包（`PENGUIN_HOME` 指向插件仓库内 `.data/penguin-plugin` 这类长期路径，`penguin plugin link` 链进该实例的前缀）、四个来源、以及分享步骤——后者驱动索引仓的 CONTRIBUTING 而不复述它。Skill 页与 `plugins/README.md` 指回这一份技能；agent-development 行保持六个 Skill。
