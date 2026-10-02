# 向后兼容：开关出现之前保存的沙盒设置

- **Date:** 2026-10-02
- **Type:** feat
- **Scope:** `server`

[English](2026-10-02-backward-compatibility-sandbox-switch.md)

[沙盒卡片的开关](2026-09-30-simple-sandbox-settings.zh.md)存为沙盒设置文档（`web.db` 中的 `plugin-config:sandbox`）里的 `enabled`。此前保存的文档没有 `enabled`。

## 旧形态：没有 `enabled`

这类文档按**其策略是否有任何封禁**推出开关：封禁模式不是「关闭」、网络不是完全开放，或设置了屏蔽路径，即视为打开；否则视为关闭。卡片显示这个值，服务端也按它实施，因此原本处于封禁的部署保持封禁，原本开放的保持开放。磁盘上的文档不改写；只有管理员改动开关并保存卡片时才写入 `enabled`。

## 旧形态：有 `mode` 与 `network`，没有 `defaultPreset`

卡片不再有单独的封禁模式与网络，新会话从默认预设开始。没有 `defaultPreset` 的存量文档，**在卡片保存一次之前**，继续按其自身的 `mode` 与 `network`（连同临时目录与屏蔽路径）封禁新会话，卡片不显示这两项。卡片的每次保存都会写入 `defaultPreset`（未选其他行时为 Workspace Write），此后由默认预设决定。读取从不改写文档。

两者适用于所有数据根，启动与热推送时都一样。**用户无需任何操作**，但卡片第一次保存会让新会话改从默认预设开始，保存前请确认「默认」列。

## 何时可以移除

两处兜底都在 `packages/server/src/sandbox/settings-policy.ts`（`sandboxEnabledOf`、`sandboxStartOf`）。保存只写入改动过的字段，文档在开关被改动之前一直没有 `enabled`，在卡片保存之前一直没有 `defaultPreset`，所以兜底不会自行失效。维护者选定以下之一后即可移除：一次性迁移，把 `enabled` 与 `defaultPreset` 写入这类文档；或明确宣布不兼容，按开关关闭与出厂默认预设读取它们。在此之前，每次读取只多几次比较。
