# 开发 Skill 记下一批 PR 踩过的坑

- **Date:** 2026-08-28
- **Type:** process
- **Scope:** `skills`
- **PR:** [#536](https://github.com/Prism-Shadow/penguin-harness/pull/536)

[English](2026-08-28-dev-skill-review-notes.md)

`.agents/skills/penguin-harness-dev/SKILL.md`新增四条说明，每一条都来自
[#528](https://github.com/Prism-Shadow/penguin-harness/pull/528)–[#534](https://github.com/Prism-Shadow/penguin-harness/pull/534)
这一批中被 review 拦下的缺陷。

## 细节

- 点明「改默认模型」比「加一个模型」波及更广：六处首次运行命令用 `--set-default` 手写了它，
  旧 id 留在那里就会在每个全新安装上把改动撤销；`models` 与 `configuration` 的示例又在两处
  携带它，必须一起改。
- changelog 契约点名两个真正会被遗漏的字段——`PR`，并给出找出缺失条目的 `grep`；以及需要翻译的
  小节标题，`.zh.md` 里留着英文标题正是中英不再逐节对应的常见方式。
- 验证一节提醒：只照着正常路径写的 fake 会掩盖它本该抓住的缺陷，因为与真实适配器产生偏差的正是
  失败契约。
- 同一节还提醒：在基线提交上就已成立的结构性断言不是测试，并给出区分二者的回放方法；另记下服务端
  测试套件在完全并行下会掉几个用例、单独跑则通过。
