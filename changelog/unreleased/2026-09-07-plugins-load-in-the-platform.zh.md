# 插件改由 platform 加载，于是「怎么加载」也能靠推送改变

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `server`

[English](2026-09-07-plugins-load-in-the-platform.md)

一个部署运行哪些插件、这份清单怎么读，是配置与策略；但 `loadPlugins` 跑在 **runtime** 的进程启动阶段。于是程序比某条规则旧的机器，永远学不会它——这不是假设：一台机器已经收到了 Project 的插件清单，却所有插件都不生效，因为它的程序仍在找数据根下旧的 `plugins.json`，只能靠重启解决。

现在由 platform 在自己的 boot 里读闭包并 import。**凡是能接受推送的部署，就能接受插件变更**——不需要重启，也不问它的程序有多旧。

留在注册表里的是已 import 的对象：一次 swap 不能弄丢的状态，由下一个 App claim 并按 specifier 复用，绝不重复 import。闭包不再提到的条目，直接不在新的 host 里，它的模块随旧 App 一起离开树。

应用路径缩小成只有 runtime 能做的那件事——把 App 再组装一次——顺带消灭了一整类 bug：注册表现在只由**成功的** boot 写入，于是不可能再出现「插件显示已启用、而运行中的树里根本没有它」。

runtime 仍保留一份自己的加载作为垫片，供比这次改动更旧的 platform 回滚时使用。
