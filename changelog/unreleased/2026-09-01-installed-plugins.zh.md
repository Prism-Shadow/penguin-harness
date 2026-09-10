# Project 要求的插件，以及进程实际在跑的那些

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#383](https://github.com/Prism-Shadow/penguin-harness/pull/383)

[English](2026-09-01-installed-plugins.md)

插件页原本只列出可安装的目录，却完全没说这台部署自己在跑什么。现在有了界面。

## 已安装的插件

插件页标题旁的图标打开 **已安装的插件**：当前 Project 要求的插件（其 `.project_config.toml` 里的 `[plugins]` 表），以及其中哪些正在被当前进程运行——这是两件不同的事实，刻意分开呈现。要求一个插件是同意，不是下载：只有随构建发布的插件可以被要求（`POST /api/projects/:p/plugins/installed { specifier }`，管理员），构建没有带的名字会被拒绝而不是写入列表，因此 Project 永远不会指名一个不在机器上的包。插件页每一行都带这个控件，可以在读到它的地方直接要求，之后该行会显示它对这台部署意味着什么——安装中、等待重启、还是正在运行。移除（`DELETE …?specifier=`）只从列表里去掉；磁盘上什么都不变。

已列出的插件在运行中的进程持有它时即为运行中。进程加载不了的——specifier 无法解析、包不是插件、import 抛错、模块名已被另一个插件占用——会带着原因显示，而不是被算作「待重启」。`GET`（该 Project 的成员即可）与 `PUT { plugins }`（管理员）读取和重写列表。
