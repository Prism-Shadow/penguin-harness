# skills 包 README 重新列全整个库

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `skills`

[English](2026-08-23-skills-readme-group-table.md)

`packages/skills/README.md` 的分组表只列了 18 个 Skill 中的 14 个：`bento-slides`、`humanizer`、
`remote-claude-code`、`skill-porting` 进了 `SKILL_GROUPS`，也进了文档站，唯独没进 README。这次补上
四个，并新增一个从库里推导的测试，让这张表不会再落下。

## 细节

- 表格按 `SKILL_GROUPS` 的顺序排列，表下一行点明两个 `preinstall: false` 的 Skill——`humanizer` 与
  `remote-claude-code`——按需从库中安装。
- 新测试读取 `README.md`，断言 `loadLibrarySkills()` 返回的每个名字都出现在其中，与 docs 包的
  `skills-sync.test.ts` 同构。原有的分组断言只能抓到"漏进 manifest"，README 此前无人看守。
