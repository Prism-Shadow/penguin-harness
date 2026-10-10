# 向后兼容：开关出现之前保存的沙盒设置

- **Date:** 2026-10-02
- **Type:** feat
- **Scope:** `server`
- **PR:** [#975](https://github.com/Prism-Shadow/penguin-harness/pull/975)

[English](2026-10-02-backward-compatibility-sandbox-switch.md)

[沙盒卡片的开关](2026-09-30-simple-sandbox-settings.zh.md)存为沙盒设置文档（`web.db` 中的 `plugin-config:sandbox`）里的 `enabled`。此前保存的文档没有 `enabled`。

## 旧形态：没有 `enabled`

这类文档按**其策略是否有任何封禁**推出开关：封禁模式不是「关闭」、网络不是完全开放，或设置了屏蔽路径，即视为打开；否则视为关闭。卡片显示这个值，服务端也按它实施，因此原本处于封禁的部署保持封禁，原本开放的保持开放。磁盘上的文档不改写；只有管理员改动开关并保存卡片时才写入 `enabled`。

## 旧形态：有 `mode` 与 `network`，没有 `defaultPreset`

卡片不再有单独的封禁模式与网络，新会话从默认预设开始。带自身 `mode` 或 `network`（或设置了屏蔽路径——旧的「关闭」模式只存这一项）而没有 `defaultPreset` 的存量文档，**在管理员把一行设为默认之前**，新会话继续按其自身的 `mode` 与 `network`（连同临时目录与屏蔽路径）开始。卡片如实显示这个起点：

- **有一行给出完全相同的起点**——把它定为默认，新会话的策略（文件模式、网络、临时目录、屏蔽路径）与审批方式都不变：卡片在这一行名称后标「（默认）」（按表序取第一个），保存时把它写入 `defaultPreset`。出厂的表里是 Workspace Write 与 Read Only 两行，各对应网络完全开放的同名旧模式。
- **没有这样的行**——旧网络为无网络或仅本机，或旧模式为关闭而设了屏蔽路径（Full Access 不做任何封禁，对不上）：不标任何一行为默认，卡片顶部的提示写明实际生效的值与改法（在一行的「…」菜单里把它设为默认，或先添加一条同值的预设再设为默认），保存其他字段也不写入 `defaultPreset`，起点仍是旧值。

没有 `mode` 或 `network` 的文档（全新安装，或只经新卡片保存过的）不属于此形态：每次保存都写入 `defaultPreset`，未选其他行时为 Workspace Write。因此保存卡片本身不会让原本封禁的部署放宽：只有管理员选定一行之后，新会话的起点与非管理员的上限才改由默认预设决定。读取从不改写文档。

两者适用于所有数据根，启动与热推送时都一样。**用户无需任何操作。**

## 何时可以移除

两处兜底都在 `packages/server/src/sandbox/settings-policy.ts`（`sandboxEnabledOf`、`sandboxStartOf`）。保存只写入改动过的字段，文档在开关被改动之前一直没有 `enabled`，在某次保存写入一行之前（有行对得上时即下一次保存，否则要等管理员选定）一直没有 `defaultPreset`，所以兜底不会自行失效。旧起点的读取还包括同一文件中的 `prePresetStartOf` 与卡片提示（`prePresetNotice`），以及 `settings-status.ts` 中用到它们的 derive、saving 与 status 钩子。维护者选定以下之一后即可移除：一次性迁移，把 `enabled` 与 `defaultPreset` 写入这类文档；或明确宣布不兼容，按开关关闭与出厂默认预设读取它们。在此之前，每次读取只多几次比较。
