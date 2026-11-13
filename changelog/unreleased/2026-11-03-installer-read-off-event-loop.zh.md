# 安装机器时读取安装包不再停住服务端

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `server`
- **Issue:** [#1435](https://github.com/Prism-Shadow/penguin-harness/issues/1435)

[English](2026-11-03-installer-read-off-event-loop.md)

`installOnRemote` 原先在请求路径里用 `fs.readFileSync` 读取安装包资产。这份资产有几十到几百兆字节，还可能放在慢速或网络挂载的目录上；现在改走 `fs.promises.readFile`，准备安装期间服务端的事件循环继续应答其他请求。

## 细节

- 读取的失败形态不变：安装包缺失或不可读时，安装仍在 `prepare the installer` 步骤结束，并带上文件系统自己的错误信息。
- 新增一条回归测试：把读取停在一份 FIFO 安装包资产上，先确认计时器在喂入字节之前照常触发，再让安装沿着它的通道跑到 `installed` 结果。
