# 停止应答的机器不再把 connect 拖进无限循环

- **Date:** 2026-08-31
- **Type:** fix
- **Scope:** `server`, `web`

[English](2026-08-31-machine-connect-loop.md)

当机器上的 server 已死而通向它的 ssh forward 还活着时,应用会永远空转:探测、connect 任务、server 启动在紧密循环中反复触发,`server status` 进程在机器上不断堆积,两侧负载持续上升,直到页面被关闭。

## 细节

- 循环的形状:Session 列表的可达性探测发现机器不应答,于是请求自动连接;自动连接相信机器列表里的 `connected`——那是关于 forward 的事实,一个活在**本侧**、能活过对侧 server 的 ssh 进程——于是立刻宣告成功;成功监听器重跑探测;机器依旧沉默;而那次"成功"的尝试已被遗忘,新的尝试随即开始。退避从未生效,唯一能启动死掉 server 的任务也从未运行,因为 connect 只凭 forward 一面之词回答"Already connected"。
- 自动连接现在先问机器本身(经代理的 `/api/me`)再算连接成功。永不应答的机器会走完递增的重试计划,落到被记住的放弃——和从未可达的机器一样。
- connect 现在即使 forward 已在,也会探测那边实际在跑什么,没有就启动它——被沉默机器引发的那次重连,正是治好它的那次。
