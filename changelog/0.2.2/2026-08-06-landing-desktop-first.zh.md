# 落地页首页以桌面应用为先

- **Date:** 2026-08-06
- **Type:** process
- **Scope:** `landing`
- **PR:** [#221](https://github.com/Prism-Shadow/penguin-harness/pull/221)

[English](2026-08-06-landing-desktop-first.md)

首页现在把桌面下载作为第一条安装路径；CLI 与自托管内容下移到折叠线之下的快速开始处。

- 首屏：CLI 一行安装框被一个按平台感知的「下载 \<OS\> 版」主按钮取代，指向 `/download`（检测失败时使用通用文案），另有一行「全部平台」，以及一条「CLI 与自托管安装 ↓」链接跳到快速开始；GitHub 按钮保留。
- 结尾 CTA：主按钮 → `/download`，次按钮 → 快速开始；「阅读文档」保留。
- 快速开始第 1 步的桌面说明改从「已经在用桌面应用了？」的角度切入（共享本地数据根目录），仍然链接到下载页。
- 操作系统检测抽取到 `src/lib/platform.ts`，由首屏与下载页共用；`/download` 页本身——产物链接、镜像解析、校验和、首次启动 FAQ——以及小节顺序、导航锚点与路由外壳均未改动。
