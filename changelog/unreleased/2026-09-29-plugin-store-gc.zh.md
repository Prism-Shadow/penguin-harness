# 插件仓与激活目录会被清扫

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`
- **PR:** [Myriad-Dreamin/penguin-harness#101](https://github.com/Myriad-Dreamin/penguin-harness/pull/101)

[English](2026-09-29-plugin-store-gc.md)

`<数据根>/plugin-store/` 与 `<数据根>/plugins/` 不再随每次推送、安装和插件改动一直增长。每次激活让 `plugins/current` 换了一代之后，以及服务端启动时，各清扫一次。清扫尽力而为：失败只记日志，从不让启动失败。

## 保留什么

- 仓里的条目满足任一条就保留，否则删除：
  - 被当前一代或上一代链接；
  - 被 harness 仍保留的热推送资产集（`hmr/store/assets/` 下当前那一份与回滚那一份）的激活清单列出。清单是构建写进插件 prefix 的 `index.json`；该文件出现之前的推送，取 prefix 的 `package.json`，其中列出的每个名字与版本的所有内容都保留。平台从未解开过的回滚资产集，从它的 `archives/plugins.tgz` 里读；
  - 被任何 Project 的表钉住，不论共享表还是任何一台机器的表；
  - 入仓不满一天。
- 没有 `.stored` 的条目是没写完的写入，满一天删除。
- 空的 `<版本>/` 与 `<名>/` 目录随最后一个条目一起删除，`index.json` 随之重建。
- 除当前一代与上一代之外的代都删除。
- `plugin-store/.staging/` 下所属进程已不在运行的目录删除。
- 要保留什么读不出来时（某一代、某个资产集的清单），这一次清扫不删任何仓条目；旧的代与失效的暂存目录照删。

## 次序

- `plugins/previous` 记下 `current` 上一次翻转之前指向的那一代。清扫保留的两代就是 `current` 与 `previous`。
- 清扫与激活在同一次启动里、指针写好之后运行，因此排在平台的装配队列上，永不在写一代的途中进行。清扫仓的部分还要排在仓的写入之后；registry 现取现在也排在这条队列上。
- 构建自带、但没有任何一代链接的包，与其他条目一样会被清扫。下一次激活会从随包的 prefix 重新入仓，Project 要它时它就在。
- [Myriad-Dreamin/penguin-harness#100](https://github.com/Myriad-Dreamin/penguin-harness/pull/100) 之前的键（node-tar 的 hash）下的条目，不会再被新的一代链接，满一天后删除。
