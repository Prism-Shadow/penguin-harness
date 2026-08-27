# 终端 resync 测试不再依赖屏幕残留

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `server`, `ci`
- **PR:** [#516](https://github.com/Prism-Shadow/penguin-harness/pull/516)

[English](2026-08-27-terminal-resync-flake.md)

`terminal stream backpressure > resyncs a lagging viewer with a fresh Restore instead of
disconnecting it` 一天之内在 macOS CI 上失败五次，落在五个与终端毫无关系的 pull request 上，而每一次重跑都通过。
它的 resync 断言读的是灌注输出末尾只打印一次的标记，而那行字要留在 24 行的屏幕上，前提是服务端恰好在这一轮
灌注平息之后才拍下快照——而这个时刻并不由测试决定。此次把断言改为读取 resync 真正承诺的东西，并一并去掉了
那两处把一次抖动放大成长达数分钟硬失败的机制。

## 细节

- resync 的 Restore 现在被断言为 `renderRestoreAnsi` 发出的那份自足重绘——重置、离开 alternate buffer、
  清屏并清 scrollback——且其中带有由灌注自身的填充行构成的连续若干行。无论观众的 socket 在哪一刻跌破低水位，
  这两点都成立，灌注进行途中也一样；而 `BURST-DONE-` 这个末尾标记只在灌注平息之后才成立。测试钉住的东西没有变：
  服务端仍然必须把暂停读取的观众标记为落后，socket 仍然必须处于 `OPEN` 而不是被断开，第二帧 Restore 仍然必须到达，
  其后这条流仍然必须能继续送出实时输出。
- 落后判定被限定在当前这一次尝试之内。该测试文件捕获的服务端日志会跨越单次尝试存活，而 vitest 在 macOS 上会重试
  这个文件，于是第二次尝试读到了第一次留下的 `pausing for resync`，径直跳过整个灌注循环，然后在一个从未被灌注过的
  终端上白等 60 秒的期限。
- 流客户端改在 `finally` 里关闭。此前断言一旦失败就会跳过写在末尾的 `close()`，把 socket 留在连接状态，于是
  `afterAll` 中的 `server.close()` 永远等不到回调，一次运行便会在真正的失败之上再叠加一条 10 秒的 hook 超时。
- 灌注期间改用 `ws.pause()` 暂停，而不是去暂停它下面那个 socket。`ws` 在自己的 receiver 积压时会自行暂停该 socket，
  并在 receiver `drain` 时再把它恢复，只有调用方主动要求的暂停才会被它尊重。
