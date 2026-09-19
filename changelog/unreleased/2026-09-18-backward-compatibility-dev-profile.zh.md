# 向后兼容:profile 延伸到机器之前写下的机器记录

- **Date:** 2026-09-18
- **Type:** process
- **Scope:** `server`
- **PR:** [#544](https://github.com/Prism-Shadow/penguin-harness/pull/544)

[English](2026-09-18-backward-compatibility-dev-profile.md)

[以 `--dev` 把已安装的构建作为第二个实例运行](2026-08-29-desktop-dev-profile.zh.md)让 profile
在远程机器上同样成立:dev profile 的实例触及那台机器上的 `~/.penguin-dev`,而此前所有实例触及的都是
`~/.penguin`。**dev profile** 数据根里已有的机器记录(`~/.penguin/dev-data/web.db` 中的 `machines`
行,由 `pnpm dev`、`pnpm desktop` 或更早的 `--dev` 构建写下)描述的是 release 安装。release profile
的记录不受影响:它们的布局就是写下它们时的布局。

## 记住的端口

dev profile 的行记住了 release server 在那台机器上占用的端口,即 `remote_port`。

- 当该端口是 release 的默认端口 7364 时,它被忽略,dev server 在自己的默认端口上启动。在 7364
  上启动会在 release server 停着时成功,随后一直占着 release server 回来时要用的端口。
- 其他记住的端口会被优先尝试。若进程未提供服务就退出——端口被 release server 占着——则尝试一次本
  profile 的默认端口,行里记住的是那台机器最终提供服务的端口。

这两条规则都不是迁移垫片,这里没有任何内容计划移除。记住的端口只是对一台别人也在用的机器的提示;
「绝不用另一个 profile 的默认端口」和「回落一次到本 profile 的默认端口」是对待提示的方式,对任何构建
写下的行都适用。

## 记录的安装

dev profile 的行若记录了已安装版本,记录的是 `~/.penguin` 里的安装。dev 实例现在查看
`~/.penguin-dev`,找不到程序,连接会带着那台机器自己的报错失败,并给出安装入口。**从 dev 实例安装
一次**即可;无须先在那台机器上删除任何东西,那里的 release 安装保持原样。

这些行不会被提前改写或清空:记录由那次安装纠正,在此之前,它只对一台 dev 实例本来就触及不到的机器
说错了话。
