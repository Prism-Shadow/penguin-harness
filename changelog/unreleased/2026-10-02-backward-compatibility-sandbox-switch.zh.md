# 向后兼容：开关出现之前保存的沙盒设置

- **Date:** 2026-10-02
- **Type:** feat
- **Scope:** `server`

[English](2026-10-02-backward-compatibility-sandbox-switch.md)

[沙盒卡片的开关](2026-09-30-simple-sandbox-settings.zh.md)存为沙盒设置文档（`web.db` 中的 `plugin-config:sandbox`）里的 `enabled`。此前保存的文档没有 `enabled`。

## 旧形态：没有 `enabled`

这类文档按**其策略是否有任何封禁**推出开关：封禁模式不是「关闭」，或虽为「关闭」但切断了网络或设置了屏蔽路径，即视为打开；否则视为关闭。卡片显示这个值，服务端也按它实施，因此原本处于封禁的部署保持封禁，原本开放的保持开放。磁盘上的文档不改写；只有管理员改动开关并保存卡片时才写入 `enabled`。

适用于所有数据根，启动与热推送时都一样。**用户无需任何操作。**

## 何时可以移除

兜底逻辑在 `sandboxEnabledOf`（`packages/server/src/sandbox/settings-store.ts`）。保存只写入改动过的字段，所以文档在开关被改动之前一直没有 `enabled`，兜底不会自行失效。维护者选定以下之一后即可移除：一次性迁移，把 `enabled` 写入这类文档；或明确宣布不兼容，把它们读作关闭。在此之前，每次读取只多一次比较。
