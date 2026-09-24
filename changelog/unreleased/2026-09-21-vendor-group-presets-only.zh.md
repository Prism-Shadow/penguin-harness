# 一方厂商分组只承载内置模型

- **Date:** 2026-09-21
- **Type:** fix
- **Scope:** `web`, `server`, `cli`, `core`

[English](2026-09-21-vendor-group-presets-only.md)

在一方厂商分组——DeepSeek、Google、OpenAI、Anthropic、Z.AI、Moonshot、MiniMax、Penguin Go——里配置
自己的模型，得到的是一个跑不起来的条目。这些分组不落 `client_type`，AgentHub 只按上游模型 id 的写法
为每个条目选择客户端；超出其路由规则的 id 到发起请求时才由 AgentHub 自己回答：`qwen/qwen3.8-flash-next
is not supported. Supported client types: minimax-m3, gemini-3.8, …`。连通性测试把这句话原样转述，
弹窗也没给出任何出路。现在这些分组只承载内置目录，写入该状态的入口一并关闭。

## 判据

`isVendorGroup`（core，`packages/core/src/state/model-catalog.ts`）为全应用回答「这个分组是否只按模型
id 路由」：目录认识、不是 `custom`、没有网关 base URL、也不钉自己的协议。`unroutableVendorModel` 把它
与 `resolveModelEnv` 配在一起——后者本就逐分支镜像 AutoLLMClient 的路由规则——回答「这个条目会不会无法
落到任何客户端」；没有任何一处按上游报文的文本做匹配。

## 模型配置页

- 每个厂商分组的组头去掉了新增模型入口。custom、自建分组与网关分组保留各自的入口；页面其余的分组操作
  ——批量 API key、测速、控制台外链——在所有分组上都不变。新增弹窗中厂商分组专用的标题与协议提示一并移除，
  Penguin Go 新增时预填 base URL 的分支同理。
- 条目若 id 无法路由，卡片上给出警示，出路按目录是否认识这一对 `(provider, model_id)` 分流
  （`unroutableFix`）：目录认识的，是在目录为其 id 钉下协议之前保存的内置模型，给出**同步预置**——即页头
  那套合并；目录不认识的，是手工加进来的，给出**移到自定义分组**：点开配置弹窗时该条目已完成迁移，协议可
  从 base URL 输入框的后缀菜单里选，也可按端点检测。配置弹窗内联的警示按同一口径分流，同一行不会出现两种
  说法。
- 对这类条目做连通性测试，改为说明问题所在与两种出路中适用的那一种，不再转述 AgentHub 那句话；上游原文
  写入浏览器控制台，开发者查报告时仍拿得到。

## 模型表 PUT 与 CLI

`PUT /api/projects/:projectId/models` 拒绝本次请求新引入、且 id 无法路由的厂商分组条目，返回
`400 model_not_routable`，报文点名该条目与出路，Web App 按 error code 本地化。已按该键存在的条目原样写回
——见[向后兼容](2026-09-21-backward-compatibility.zh.md)。

`penguin config model add` 直接写配置文件、不经过该路由，因此对新条目以同样的口径拒绝（退出码 1，不写入
任何内容）。已存在的条目照旧更新；显式 `--client-type`——或如 MiniMax M3 与直连 `deepseek-flash` 那样由
目录行钉住协议——即让该 id 可路由，照常接受。

## 目录自身的守卫

「内置模型必须满足按 id 路由」成为目录的一条规则，因此与目录其他不变量并列钉进测试：厂商分组下的每一条
`MODEL_CATALOG` 记录都能经 `resolveModelEnv` 解析——按其钉住的 `client_type`，或按其 id。
