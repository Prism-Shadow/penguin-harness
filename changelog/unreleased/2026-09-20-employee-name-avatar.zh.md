# 公司模式：员工有名字和头像，`@名字` 也能找到人

- **Date:** 2026-09-20
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `plugins`
- **PR:** [#809](https://github.com/Prism-Shadow/penguin-harness/pull/809)

[English](2026-09-20-employee-name-avatar.md)

此前员工的称呼取自 Agent 的显示名——而作为员工创建的 Agent，显示名往往就是它的 id——头像则是字母色块。现在员工有了组织自己给的名字和图片，`@` 后面写 id 或名字都可以。

## 名字

- `org_chart.yaml`：员工条目可以有一个可选的 `name`——任意文字，可含空格，单行，不含 `@`，最长 64 个字符。名字由组织来取；没有名字的条目与从前一样，先用 Agent 的显示名，再用 id。
- 写下的名字不要求唯一。只属于一位员工的名字原样显示、原样可 `@`；与别人重复的名字会带上 id 作备注：`小明 (acme_dev_a)`。与另一位员工的 id、某个成员的用户 id 或 `all` 相同的名字也同样处理，因为 `@` 在那里已经另有所指。这就是 `OrgEmployeeItem.name`；`givenName` 是条目里写下的原文，供编辑使用。
- `POST …/employees` 接受 `name`（省略时用新建 Agent 的 `name`）；`PATCH …/employees/:agentId` 接受 `name`，`null` 或空字符串表示清除。CLI：`penguin org employee set <agent_id> --name <name>`。

## 提及

- 频道消息可以用 id 或名字称呼员工：`@acme_dev_a` 与 `@小明` 送达同一个工位。名字可能来自没有空格的文字，所以提及不是用正则从文本里切出来的，而是拿「可以被称呼的东西」去匹配：在一个不接续单词的 `@` 之后，文本所接续的最长称呼胜出（`@小明明` 不是 `@小明`）；以 ASCII 单词字符结尾的称呼必须在单词末尾结束（`@anna` 里找不到 `@ann`）；以其他字符结尾的称呼后面不需要空格（`@小明你好`）。`@agent:<id>` 与 `@user:<id>` 仍是显式写法；id 仍先于名字，员工仍先于同 id 的成员。
- 输入区的提及面板在输入任何文字的名字时都保持打开，选中后键入的是名字；消息里按名字写的提及与按 id 写的同样高亮。员工 Skill 说明了 `@<名字>` 可用、结构化字段仍用 id；触发块的 `employee:` 行带上了名字。`agent-company` 版本为 `2026.09.20.1`。

## 头像

- 头像是组织的一个图片文件：`avatars/<agent_id>.png|jpg|webp`，可以手工放进去，也随目录一起走。`PUT …/employees/:agentId/avatar { avatar }` 接受与个人头像相同的 data URL（png、jpeg 或 webp，最长 131072 个字符），`null` 表示移除；`GET …/avatar` 提供图片，凭 `OrgEmployeeItem.avatarRev` 给出的 `?rev=` 永久缓存。
- Web：员工树菜单里的「名字与头像」打开一个同时编辑两者的弹窗，头像选择器与个人头像用的是同一个。员工树、工位列表、频道消息与成员、财务表和主体标签都显示这张图片；没有头像的员工仍是字母色块。招募弹窗里也可以填名字。
