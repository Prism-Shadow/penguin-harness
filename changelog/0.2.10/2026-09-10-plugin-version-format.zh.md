# 插件版本改写作 `2026.09.10.1`

- **Date:** 2026-09-10
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#666](https://github.com/Prism-Shadow/penguin-harness/pull/666)

[English](2026-09-10-plugin-version-format.md)

插件的日期版本——`plugin.json` 声明、插件库卡片展示的那个——改写作 `YYYY.MM.DD.N`：分隔一律
用点，不再用短横线，原先的 `2026-09-10.1` 现在写作 `2026.09.10.1`。日期与序号不变，版本的含义也不变，
变的只是写法。它是插件自身的内容版本，与该插件包跟随发行版本的 npm 版本无关。

## 格式

- `PLUGIN_VERSION_PATTERN` 为 `/^\d{4}\.\d{2}\.\d{2}\.\d+$/`，库内 `plugin.json` 必须匹配它：
  清单校验对其余形式报 `version must be YYYY.MM.DD.N`。
- 十二份内置清单就地改写，各自保留原有的日期与序号（`2026-07-20.1` → `2026.07.20.1`）。
  `continual-learning` 另行升至 `2026.09.10.1`，那是一次真实的内容变更：它的 stop hook 提示词
  现在要求 Agent 按新格式提升 SKILL.md 的版本。
- 安装口径不变：loader 把插件的版本字符串原样盖章进各已装 `SKILL.md` 的 frontmatter 与生成的
  `hooks.json`。
- zip 导出的文件名后缀仍为 `-v<版本>`：`penguin-sdk-v2026.09.10.1.zip`。

## 两种写法都读

`parsePluginVersion(version): { date: string; seq: number } | null` 把两种写法解析成它们共同表示
的日期与序号，`comparePluginVersions` 建立在它之上，因此 `2026-09-02.1` 与 `2026.09.02.1` 比较
相等。已装副本的 frontmatter 与清单解析两种写法都收；只有库内清单被要求使用新写法。这样做换来了
什么、旧写法分支何时可以删除，见
[`2026-09-02-backward-compatibility`](2026-09-02-backward-compatibility.zh.md)。

## 说明该格式的文案

插件卡片的元信息行照旧在版本前显示一个 `v`，相对日期改按新写法解析。钩子导入提示词的固定尾段
要求 Agent 产出的 `hooks.json` 的 `version` 使用 `YYYY.MM.DD.N` 格式，中英两份词典一致；插件文档
中的 `version` 行、版本比较示例与清单样例也随之更新。
