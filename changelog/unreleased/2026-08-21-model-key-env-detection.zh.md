# 由环境变量提供 key 的模型同样算作已配置

- **Date:** 2026-08-21
- **Type:** fix
- **Scope:** `web`

[English](2026-08-21-model-key-env-detection.md)

对话的模型选择器此前只按存储的掩码 key 判定「是否配置了 API key」，而模型库早已把由环境变量提供 key 的模型显示为已配置。于是 key 来自 `ANTHROPIC_API_KEY` 的模型会被折到选择器的「显示未配置 key 的模型」展开行之后、并带上划掉的 key 图标——而同一屏里模型库卡片正打印着该变量的掩码值。两处判定改为同一条规则：存储的 key **或**服务端已确认存在取值的环境变量兜底。

## 细节

- `hasConfiguredKey`（`model-grouping.ts`）成为所有界面共用的唯一判定——选择器的默认列表、划掉的 key 图标、以及「显示未配置 key 的模型」的计数都读它——`ModelCredentialRowLike` 随之新增 `envKeyMasked`。`envKey` 依旧不作数：它只是兜底变量的名字，并不能说明该变量是否有取值；而服务端只为当前确有取值的变量输出 `envKeyMasked`。
- 模型页自己的 `hasKey` 改为构建在该判定之上，只额外承担 DTO 形状无法携带的两件事：对话框里刚输入、尚未保存的 key 立即算数；`clearApiKey` 只清除**存储的** key——环境变量无法从这里清除，因此由环境变量支撑的条目在清除后仍然有 key。卡片的 key 状态行抽为 `keyStatusText`，并由同一个 `hasKey` 把关，卡片与选择器不会再对「哪些条目未配置」给出不同答案。
- 对话的 credential 引导——只弹一次的「尚未配置模型 credential」对话框——改为对 Project 的默认模型调用 `hasConfiguredKey`，不再直接读它的掩码 key；默认模型靠环境变量运行的 Project 首次进入时不会再被提示。
