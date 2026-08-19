# Web App：Agent 设置页上的 Skill 管理，以及可深链的列表图标

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#179](https://github.com/Prism-Shadow/penguin-harness/pull/179), [#186](https://github.com/Prism-Shadow/penguin-harness/pull/186)

[English](2026-08-04-agent-skills-and-list.md)

## Skills 标签页

Agent 设置新增一个 Skills 标签页，紧排在 Tools 之后。已安装列表每次拉取都会重新读取 `agent_state/skills/`——该目录始终是唯一事实来源，与 vault 和定时任务文件完全一样，因此手工安装或由 Agent 安装的 Skill 无需任何注册表即可出现。每行携带 Skill 图标、名称、本地化的简短描述与版本/更新元信息；卸载前会先请求确认。

标签页头部可打开一个导入对话框，它以推荐路径开场：通过与 Agent 对话来安装。来源字段接受的不止是网页 URL——还可以是 GitHub/GitLab 仓库或目录、本地文件夹路径、来自其他生态的安装命令（`npx skills add …`、Claude Code / Codex 插件安装——那些插件本质上就是 Skill 文件），或者一个裸的市场引用——而一个小型分类器会按形式定制生成的提示词（抓取该页面 / 克隆并定位 SKILL.md 目录 / 读取该文件夹 / 推断该命令会安装什么并从其源头抓取，而不是盲目执行它）。每个变体都保留「先审阅」条款，并在 skill-porting 库 Skill 已安装时指向它。「打开新会话」会经既有的草稿缓存把生成的提示词预填进输入区——Agent 可以对它所安装的内容做出调整，而盲目解压做不到这一点。该对话框的第二条路径是上传一个 Skill zip：新增的成员级 `POST /api/projects/:p/agents/:a/skills/archive` 以 base64 JSON 接收压缩包（这是该 API 既定的上传形态），接受位于 zip 根部、或位于恰好一个顶层目录之内的 `SKILL.md`，按常规名称模式从该目录派生名称（否则取自 frontmatter），拒绝路径逃逸条目，并把载荷限制在 200 个文件 / 单文件 5 MB / 解压后 20 MB 之内。上传一个已安装的名称会得到 409，而对话框会提供一个显式的覆盖选项，它会整体替换该目录。解压使用 server 包中新增的 `fflate` 依赖。

反方向也一并提供：每一行都带一个导出操作，把已安装的 Skill 下载为 `<name>.zip`——当 frontmatter 声明了显式版本时则为 `<name>-v<version>.zip`——整个目录置于单个顶层文件夹之下，像 trace 下载那样作为直接附件提供，并受同样的大小上限约束，因此一个 Skill 经导入端点往返之后原样不变。导出与卸载是带 tooltip 的图标按钮，遵循工具行所采用的「图标加 tooltip」规则。

## Agent 列表

每个 Agent 行上的工具、vault key、定时任务与 Skill 这几个统计图标，现在都是按钮，点击会打开设置页并落在对应的标签页上。设置页为此学会了 `?tab=` 深链：其取值会对照实时的标签页列表校验（未知取值回退到 Overview），而切换标签会保持 URL 同步且不污染浏览历史。列表行上的活动会话数徽章已移除——会话那一列本就说明了这件事——而设置页的 Overview 保留其活动会话数字。
