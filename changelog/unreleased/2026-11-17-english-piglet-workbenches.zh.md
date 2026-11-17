# 两个内置工作台应用：英语学习工作台与猪猪的摸鱼小世界

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `plugins`, `server`, `desktop`, `docs`
- **PR:** [#1587](https://github.com/Prism-Shadow/penguin-harness/pull/1587)

[English](2026-11-17-english-piglet-workbenches.md)

插件库新增两个只含应用的插件：`english-workbench`（英语学习工作台，English Learning Workbench）与 `piglet-stickers`（猪猪的摸鱼小世界，Piggy Sticker World）。两者都不含 Skill，也都不预装：从插件库安装到某个 Agent 后，应用才会出现在对话旁和应用中心。

## 细节

- 英语学习工作台：三部公版名著（奥斯汀、柯南·道尔、雪莱）逐句朗读并高亮单词，配标注词、中文对照与左右开页；三篇新闻和一场 TED 演讲以链接、摘要、标注词和观点题导读，并可粘贴正文精读；任意粘贴的文章同样可以精读；词句库带间隔复习；另有跟读录音（只留在本地）、考试微练、每日计划与学习记录导出。
- 学习记录是工作台状态里的一份文档，没有账号，也不读取文件。「每日外刊」在学习者打开之前不联系任何主机；打开后服务端只以本工作台自己的 `User-Agent` 读取一份固定的公开订阅源（`feeds.npr.org`、`feeds.a.dj.com`、`www.latimes.com`、`www.wired.com`、`www.smithsonianmag.com`、`www.sciencedaily.com`、`www.nature.com`），文章靠粘贴正文精读，从不抓取文章页面。
- 猪猪的摸鱼小世界是贴纸造景小游戏：208 张贴纸、13 个场景、10 个主题关卡，另有每日目标、盲盒与可导出 PNG 的作品。小猪换成了全新的原创 emoji 风格形象，以 SVG 绘制，覆盖游戏用到的每个姿势和表情；第 8 关改名为「月亮下的加餐时间」（Moonlight Snack Time）。
- 两个应用都按设备语言显示中文或英文界面，切换按钮当场生效并记住选择。英语学习工作台只翻译界面与帮助，所教的英文保持原文。
- 进度按 Agent 分别保存在工作台自己的状态里，换一个浏览器也能看到；卸载插件会删除这些进度。
- 服务端的插件库测试把 Workbench 算作插件的组成部分，与 Skill、钩子包并列；桌面端构建对打包产物的检查也接受只带 Workbench 的插件。
