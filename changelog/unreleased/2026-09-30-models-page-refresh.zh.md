# 模型配置页：分组标题栏、连接与账户余额

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `web`, `server`, `cli`, `model-catalog`, `docs`
- **PR:** [#914](https://github.com/Prism-Shadow/penguin-harness/pull/914)

[English](2026-09-30-models-page-refresh.md)

模型配置页的分组标题栏重做：分组的 key 在分组标题栏统一管理；三个由授权流程取得 key 的分组从「自动获取密钥」改为「连接」；两个提供账户余额查询的厂商显示余额；所有分组上方加一条推荐 TokenDance 钱包的横幅。模型卡片保留三行的样式，加上供应商 logo。

## 模型卡片

- 每张卡片以供应商 logo 开头，与对话里模型选择器的行一致；卡片的其余部分和网格排布不变。

## 分组标题栏

- 展开/收起的箭头紧跟在分组名和模型数后面，不再放在标题栏最右侧。模型数改为和选择器分组栏一样的纯数字。
- 右侧操作按固定顺序排列，由一处决定（`groupHeaderActions`，`group-header.ts`）：余额、分隔线、**连接**及其状态、**同步**（已连接的 Penguin Go）、**填写密钥**、测速、**添加模型**、**删除分组**。余额后面还有内容时才画分隔线。成员只看到余额和连接状态。
- 「手动设置密钥」改为**填写密钥**。它和**连接**都是无底色的图标加文字按钮，与标题栏上其他操作一样，标题栏变窄时只留图标。**填写密钥**仍把同一把 key 写进分组里的每个模型，custom 分组仍然没有这个操作。
- 供应商密钥控制台的链接移出标题栏，只留在**填写密钥**弹窗和**模型配置**弹窗里。
- 测速是一个图标按钮，确认后开始，测速中再按即停止。停止时正在进行的那次探测照常完成，不再发起后续请求；已测出的结果保留。

## 连接

- TokenDance、Penguin Go 和 ModelScope 的「自动获取密钥」改为**连接**（链环图标），前面显示**未连接** / **连接成功**。连接成功指分组里存有 key，与 key 从哪条路径写入无关。连接成功后按钮显示**重新连接**。授权流程本身没有改动；关闭弹窗、重新加载模型表后状态随之翻转。
- 所有分组上方加一条横幅：对 owner 显示，条件是 TokenDance 分组有模型但没有 key，提供 TokenDance 的连接流程。横幅上每 6 秒一道缓慢的高光扫过，纯 CSS，`prefers-reduced-motion` 下静止。**×** 在当前浏览器里隐藏它（`penguin.tokenDanceBannerDismissed`）。

## 余额

- `ModelProviderInfo.balance` 声明厂商的账户余额接口及其答复的读法：TokenDance（`https://tokendance.space/portal/api/v1/user/balance`，`balance.balance`，单位微元）与 DeepSeek（`https://api.deepseek.com/user/balance`，每种货币一项）。
- 新增 `GET /api/projects/:projectId/models/balance?provider=<分组>[&force=1]`，Project 成员均可调用：服务端用分组已存的 key 查询，key 不离开服务端；5 秒超时，走出网代理设置；按 Project × 分组缓存 60 秒，换了 key 即不命中（`force=1` 跳过缓存）。答复为 `{ ok: true, provider, amount, currency, available?, others?, fetchedAt }`，或 `{ ok: false, error, status?, message }`，`error` 为 `unsupported`、`no_key` 或 `upstream_failed`；厂商原文不回传。
- 标题栏以灰色小字显示余额，币种跟随成本中心和模型价格所用的显示币种：按应用的固定汇率（1 美元 = 7 元）换算，账户持有多种货币时合计，¥110 加 $5 显示为 `¥145`。余额前面是两个图标：常驻（图钉）和同步（刷新），刷新图标的悬停提示给出服务商的原始金额和查询时间。查不到时显示灰色「—」，原因在刷新图标的悬停提示里（共享提示只为没有文字的元素显示）。
- 图钉（即会话列表的分组图钉，常驻时画成实心）把一个余额常驻到侧栏底部的用户名旁，币种相同。常驻按账户记在 `ui_prefs.pinnedBalance`，常驻另一个即替换；常驻的余额在页面加载时查询一次，此后每五分钟一次。

## 添加模型

- **添加模型**只出现在 custom、vLLM 和自建分组（`ModelProviderInfo.addable`，`isAddableGroup`），模型配置弹窗的分组下拉只列这些分组和该行自己所在的分组。服务端与 `penguin config model add` 拒绝在其余内置分组新增不属于预置的模型（`400 model_not_addable`）；已存的行保留。见[向后兼容](2026-09-30-backward-compatibility.zh.md)。
- **用 AI 创建**的「OpenRouter 热门模型」示例改为加成一个自建分组。

## 文档

- 模型、快速上手（桌面端）、配置与 CLI 文档按新的标题栏、**连接**、**填写密钥**、测速开关、账户余额和「只承载内置模型」规则更新，中英文同步。
