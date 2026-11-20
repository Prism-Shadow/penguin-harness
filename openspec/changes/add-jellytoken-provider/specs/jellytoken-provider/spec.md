# JellyToken 供应商功能规格

## Purpose

让用户在模型库中发现 JellyToken，通过分组设置配置自己的密钥，并在对话中使用该供应商的模型。接入沿用已有的权限、密钥继承和项目同步规则，不改变其他供应商的行为。

## ADDED Requirements

### Requirement: 可发现的分组与预设展示顺序

系统 MUST 以 `JellyToken` 展示内置分组 `jellytoken`。模型库与模型选择器默认按指定顺序展示该组的预设模型，不改变现有推荐供应商。

#### Scenario: 新项目获得九个预设模型
- **WHEN** 创建新项目并查看 JellyToken 分组
- **THEN** 九个预设的顺序为 `deepseek-v4.1-flash-1017`、`qwen4-max`、`glm-5.3`、`glm-5.3-flash`、`qwen3.8-flash`、`glm-5.3-flashx`、`doubao-seed-2.1-lite`、`doubao-seed-2-1-pro`、`kimi-k3`。

#### Scenario: 按供应商查找模型
- **WHEN** 用户在模型库查找 JellyToken，或在模型选择器中查看符合当前筛选条件的 JellyToken 模型
- **THEN** 结果位于 JellyToken 分组，不会与其他供应商的同名模型合并，也不会获得「官方推荐」标记。

### Requirement: 推理连接与请求标识

系统 MUST 默认通过 `openai-chat` 向 JellyToken 的推理网关发送请求，保持上游模型标识原样，不使用网页登录地址作为推理地址。

#### Scenario: 模型继承分组连接
- **WHEN** 新项目中的预设模型没有覆盖连接设置
- **THEN** 实际使用的基础地址为 `https://aiservice.jellytoken.com/v1`，协议为 `openai-chat`。

#### Scenario: 发送对话请求
- **WHEN** 用户选择已配置密钥且沿用默认地址的 JellyToken 模型发送消息
- **THEN** 请求携带已配置的 Bearer 密钥，发往 `https://aiservice.jellytoken.com/v1/chat/completions`；请求中的 `model` 与所选上游标识完全一致。

#### Scenario: 流式回复与工具调用
- **WHEN** 上游返回流式文本或所选模型支持的工具调用
- **THEN** 对话可以逐段显示文本或接收工具调用，不要求用户切换到 JellyToken 专用协议。

### Requirement: 分组密钥的管理与使用边界

系统 MUST 允许项目所有者保存、保留、更换或清除分组密钥；只让符合现有继承规则的模型使用它。

#### Scenario: 保存后重新打开设置
- **WHEN** 所有者保存分组密钥后重新打开设置
- **THEN** 只显示已保存密钥的掩码；未单独配置密钥且符合继承条件的模型可以使用分组密钥，不在每一行复制明文。

#### Scenario: 网关未配置密钥
- **WHEN** JellyToken 的分组和模型均未配置密钥，目标仍是 JellyToken 网关
- **THEN** 请求因缺少密钥而失败，不借用环境中的 `OPENAI_API_KEY` 或其他供应商密钥。

#### Scenario: 模型地址覆盖为另一来源
- **WHEN** 模型单独指定了与分组不同源的地址
- **THEN** 该模型不继承分组密钥，也不将分组密钥发送到该地址。

### Requirement: 两个设置弹窗的官网链接

系统 MUST 将 JellyToken 的密钥管理、模型列表和模型标识查询入口指向 `https://www.jellytoken.com/models?utm_source=penguin-harness`。

#### Scenario: 分组设置中的链接
- **WHEN** 用户在分组设置点击「前往密钥管理」或「前往模型列表」
- **THEN** 浏览器在外部页面打开上述登录地址，不携带用户的密钥。

#### Scenario: 模型配置中的链接
- **WHEN** 用户在模型配置中点击「前往密钥管理」或「获取模型 id」
- **THEN** 打开同一登录地址；查找模型标识不触发自动导入。

### Requirement: 价格与能力有据可查

系统 MUST 按已核实的 JellyToken 费率计价，只对条件明确且适用的促销使用独立折扣；不得把未知价格标为免费，也不得凭模型名称宣称支持图片。

#### Scenario: 展示价格或统计费用
- **WHEN** 模型卡片展示价格或成本中心计算费用
- **THEN** 缓存读取、缓存写入和输出按项目规定的单位分别计价；对已反映在报价中的折扣不再次扣减。

#### Scenario: 九条预设的窗口与能力展示
- **WHEN** 用户查看首版任一 JellyToken 预设模型
- **THEN** 上下文窗口统一为 1M（1,000,000 个词元），不展示「视觉」标签，也不列出支持或不支持图片的说明。

#### Scenario: 按模型展示价目表中的折扣标签
- **WHEN** 用户展开 JellyToken 分组，或通过搜索找到其预设模型
- **THEN** 每张预设卡片按技术设计表中对应的模型标识展示一个原文折扣标签（例如「6折起」「9.5折起」）；保留“起”字，不替换为固定折数或节省百分比。其他供应商的同名模型不继承此标签。

#### Scenario: 折扣标签不影响计费
- **WHEN** 成本中心计算带「几折起」标签的预设模型费用
- **THEN** 按配置的费率计价，不从标签推算固定 `discount`，不再次扣减。

### Requirement: 已有项目显式同步

系统 MUST 仅在所有者明确同步预设后为已有项目补充缺失的 JellyToken 模型，不因升级自动修改其模型表、默认模型或已保存的密钥。

#### Scenario: 升级后尚未同步
- **WHEN** 用户打开升级前已经存在的项目
- **THEN** 已保存的模型、默认选择、密钥和自定义地址保持不变。

#### Scenario: 所有者同步新增模型
- **WHEN** 所有者点击「同步新增模型」
- **THEN** 补充缺失的预设和必要的分组连接信息，不替换已有密钥、自定义模型或默认选择。
