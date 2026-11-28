# 命令策略改为默认关闭，由 Project 自行打开

- **Date:** 2026-11-28
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)
- **Breaking:** yes — Project 配置的 `[command_policy]` 里没写 `enabled = true` 的，命令策略一律关闭

[English](2026-11-28-command-policy-default-off.md)

Project 的沙盒命令策略，也就是 Project 设置「安全策略」页的 **启用策略** 开关，改为默认关闭。只有 `[command_policy]` 块里写着 `enabled = true` 才算打开；块里没有这个键，或者根本没有这个块，都按关闭读取。新建 Project 仍会写入出厂规则，策略处于关闭状态。

## 细节

- core 在策略没写 `enabled: true` 时不再匹配任何规则。没有拿到策略的 Session（SDK 嵌入方不传策略时就是这样）不套用任何规则。读取策略的回调抛错时，仍退回到出厂规则并按打开处理。
- `GET …/command-policy` 对没有这个键的块返回 `enabled: false`。`PUT …/command-policy` 每次保存都写入总开关，写成 `enabled = true` 或 `enabled = false`，因此规则原封不动时，打开的策略也会保持打开；PUT 不带 `enabled` 即存为关闭。
- 配置同步把没有这个键的块以 `enabled: false` 下发给 Project 的机器，机器照此写入。
- 设置页开关下方的说明写明：策略默认关闭，关闭意味着什么，打开后会怎样。
- 配置、工具、Web App、服务端 API 与接口文档都改为新的默认值。

## 兼容性

以往版本在策略保持打开时不写 `enabled` 键，所以升级后，已有的 Project 一律关闭命令策略，只有两种例外：所有者原本就关掉的，继续关闭；文件里写着 `enabled = true` 的，继续打开。已存的规则都保留。

策略关闭后，在任何审批模式下都没有规则再要求确认或直接拒绝：

- 在 `allow-all` 下，出厂规则覆盖的命令不再等人同意就会运行：同时带递归与强制标志的 `rm`、`mkfs`、用 `dd` 或重定向写块设备、fork 炸弹及它们在 Windows 下的写法、`gh pr merge` 与 `close`、`gh release create`、`delete` 与 `edit`、带强制标志或推到 `main`、`master` 的 `git push`，以及 `npm`、`pnpm`、`yarn publish`。组织里无人值守的 Session 在 `allow-all` 下原本会当场拒绝这些调用，现在会照常运行。
- Project 改成「拒绝」的规则也不再拒绝：在 `allow-all` 下命令照常运行，在 `read-only` 与 `always-ask` 下和其他 shell 命令一样交人决定。
- `deny-all` 不受影响。

要恢复策略，由 Project 所有者在 Project 设置的「安全策略」页打开 **启用策略**，这会写入 `enabled = true` 并同步到 Project 的机器。通过 API 恢复，则是带上 `enabled: true` 与 `GET` 返回的规则调用 `PUT /api/projects/<projectId>/command-policy`。
