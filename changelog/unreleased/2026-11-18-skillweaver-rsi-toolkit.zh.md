# SkillWeaver 工具包：把网站技能打磨成经过测试的 API 脚本

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`
- **Issue:** [penguin-harness-community#74](https://github.com/Prism-Shadow/penguin-harness-community/issues/74)

[English](2026-11-18-skillweaver-rsi-toolkit.md)

新增 SkillWeaver 自进化工具包 `skillweaver-rsi-toolkit`，复现《SkillWeaver: Web Agents can Self-Improve by Discovering and Honing Skills》（Zheng 等，2025，[arXiv:2504.07079](https://arxiv.org/abs/2504.07079)），并对照参考实现 `f2a63d65` 核对。与其余算法工具包一致，它是一个与插件同名的 Skill，承载方法与若干聚焦的参考文件；不同的是它还附带两个小脚本，因为这个方法的产物本身就是可执行代码。

## 练习循环

- 每轮从网站首页开始，按上游 `test_probability` 0.5 决定探索还是测试。
- 探索时，Proposer 根据页面、技能库和网站知识列出值得掌握的技能，按有用程度和操作步数打分，选出最佳；在真实网站上会剔除创建账号、发布内容、预订、联系客服等任何可能影响其他用户的技能。
- 测试时，按上游的练习效用（交互次数减版本号）做 softmax 选出未测试的 API，再由 Tester 根据页面生成参数。
- Target 在智能体浏览器里尝试任务。测试轮中 API 调用成功即通过；其余尝试交给 Judge 依据 Trace 与最终截图判定，被接纳的再交给 Synthesiser 编写新的或更新的 API 脚本（附使用记录），并重写网站知识。失败的尝试不写入任何东西。

## 技能库

- Target 的技能库是一个归 Target 所有的 Skill `skillweaver-apis`：API 脚本索引（签名、文档、测试次数、使用记录）、脚本本身，以及按功能组织的网站说明，通过 `AGENTS.md` 中一行固定文字读取。
- 一个 API 是基于 `penguin browser` 的 Node 模块，对应上游的 Playwright 技能函数：先打开站内相对路径，接受有类型、人类可读的参数，输出一行 JSON 结果。随附的运行时负责执行它并检查参数；在 Windows 上它直接按服务端 `penguin.cmd` 中的启动命令运行 CLI，浏览器脚本不经过 cmd.exe。
- `skillweaver.mjs` 是控制者的工具：代码校验（语法、唯一允许的导入、命名与参数规则、首次导航为相对路径、至少两次浏览器调用）、技能库记录、练习效用选择和索引生成。未通过校验的脚本连同问题退回 Synthesiser 重写，按上游做法最多 10 次，仍不通过则丢弃。技能库带有指纹，控制者在每个练习单元和每次角色调用前后校验，只有 Publish 步骤能修改它；报告中会写明哪些限制由运行强制、哪些只是指令。

## 打包

插件在 `src/index.ts` 中声明卡片、唯一的 Skill 与图标，编译为 `ifaces.json`，并设 `preinstall: false`。它已注册进 server、CLI、desktop 与 landing 的打包依赖，进入双语插件目录与官网算法列表。测试覆盖运行时（以替身 `penguin` 运行）、每条校验规则、技能库记录与文档中的 API 示例；评测说明使用公共版本。

工具包自成一体：自行创建 Target 智能体的技能库、运行练习循环、评测每个单元、写入评估中心的记分板。它需要智能体浏览器，因此要在有桌面应用或已配对 Chrome 扩展的环境中运行。
