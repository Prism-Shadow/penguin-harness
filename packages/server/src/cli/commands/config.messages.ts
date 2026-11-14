/**
 * The messages of the config command, split out of the CLI's message table (hosted whole by the server
package). Field names and shapes are unchanged; the host's table spreads this file in.
 */

export interface ConfigText {
  config: {
    desc: string;
    modelDesc: string;
    addDesc: string;
    addModelId: string;
    addProvider: string;
    /** `model add`'s connection flags: the model's own value with --model-id, the group's without. */
    addApiKey: string;
    addClearApiKey: string;
    addBaseUrl: string;
    addClearBaseUrl: string;
    addContextWindow: string;
    addMaxTokens: string;
    addClientType: string;
    addClearClientType: string;
    addVision: string;
    addNoVision: string;
    addFastMode: string;
    addNoFastMode: string;
    fastModeUnsupported: (ref: string) => string;
    addPriceCacheRead: string;
    addPriceCacheWrite: string;
    addPriceOutput: string;
    addSetDefault: string;
    defaultDesc: string;
    visionDesc: string;
    /** `model default` / `model vision` / `model remove`'s --model-id: the upstream request id (pairs with --provider as a reference). */
    refModelId: string;
    /** `model default` / `model vision` / `model remove`'s --provider: the provider group of the referenced entry (required). */
    refProvider: string;
    listDesc: string;
    removeDesc: string;
    /** `model remove`'s --model-id: optional there; without it the command removes the group's connection. */
    removeModelId: string;
    langDesc: string;
    langArg: string;
    vaultDesc: string;
    vaultSetDesc: string;
    vaultListDesc: string;
    vaultRemoveDesc: string;
    vaultKey: string;
    vaultValue: string;
  };

  langInvalid(value: string): string;

  /** `config lang` persists via POSIX shell startup files; on Windows it refuses with a pointer to a user env var instead. */
  langWindowsUnsupported(lang: string): string;

  langSet(lang: string, rcPath: string): string;

  langRestartConfirm(): string;

  langRestart(): string;

  langRestartHint(rcPath: string): string;

  /** Result output for model add/default/vision/remove: the argument is the already-formatted pair reference (formatModelRef). */
  modelAdded(model: string, defaultModel: string | undefined): string;

  modelUpdated(model: string, defaultModel: string | undefined): string;

  defaultModelSet(model: string): string;

  visionModelSet(model: string): string;

  modelRemoved(model: string, defaultModel: string | undefined): string;

  /** `model remove` on a pair the Project config doesn't have. */
  modelNotConfigured(model: string): string;

  /** `model add` refused: a new entry in a first-party vendor group under a model id MMSP cannot route (it begins with no known vendor prefix). */
  modelNotRoutable(model: string): string;

  /** A new entry in a built-in group that takes no hand-added models (every one but custom, vLLM, OpenRouter, TokenDance, SiliconFlow and Atlas Cloud). */
  modelNotAddable(model: string, group: string): string;

  /** Follows modelRemoved when the removed entry was also the vision model. */
  visionModelCleared(): string;

  /** `model list`: heads the models block. */
  modelListTitle(): string;

  modelListEmpty(): string;

  /** `model list`: heads the groups' stored connections, printed above the models. */
  groupListTitle(): string;

  /** `model add` without --model-id refused: a flag that describes one model (context window, output cap, vision, fast mode, prices, --set-default) was given. */
  modelGroupOnlyFlags(group: string): string;

  /** `model add` without --model-id refused: --provider is no built-in group, names no model, and breaks the group-name rule. */
  providerInvalidGroup(group: string): string;

  /** `model add` refused: a connection field was both set and cleared. */
  providerFlagConflict(flag: string, clearFlag: string): string;

  /** `model add` refused: a connection field was given an empty value (clearing takes its --clear-* flag). */
  providerBlankValue(flag: string, clearFlag: string): string;

  /** `model add` without --model-id refused: --base-url is not an absolute http(s) URL. */
  providerInvalidBaseUrl(baseUrl: string): string;

  /** `model add` refused: a group whose protocol is fixed (Penguin Go) given another --client-type, or its group's cleared. */
  protocolFixed(group: string, clientType: string): string;

  /** `model add` without --model-id refused: no field to set or clear. */
  providerNothingToSet(group: string): string;

  /** `model add` without --model-id done; `overriding` = the group's models a changed field passes by (their own value, or a group key that does not reach their base URL). */
  providerSaved(group: string, overriding: number): string;

  /** Follows providerSaved for a group of the user's own that has no model yet. */
  providerNoModels(group: string): string;

  /** `model remove` without --model-id refused: the group stores no connection. */
  providerNothingToRemove(group: string): string;

  /** `model remove` without --model-id done; `models` = the group's models, which all stay. */
  providerRemoved(group: string, models: number): string;

  vaultSet(key: string): string;

  vaultRemoved(key: string): string;

  vaultKeyMissing(key: string): string;

  vaultListTitle(): string;

  vaultListEmpty(): string;
}

/** The English half of this contribution's messages. */
export const configEn: ConfigText = {
  config: {
    desc: "Manage Project configuration",
    modelDesc: "Manage models, their groups' connections and the default model",
    addDesc:
      "Add or update a model; without --model-id, set a group's connection (API key, base URL, protocol)",
    addModelId:
      "Upstream model id sent to MMSP as-is (e.g. claude-sonnet-4-6); omit it to set the group's connection",
    addProvider:
      "Provider group: the model's, or the one whose connection to set; required, never inferred (use custom for anything without a vendor group)",
    addApiKey:
      "API key, stored in the Project's hidden .project_config.toml: the model's own with --model-id, else the group key (used by the group's models without a key of their own that go to the group's endpoint)",
    addClearApiKey:
      "Remove the stored API key: the model's own with --model-id (it then uses the group key), else the group key",
    addBaseUrl:
      "Base URL: the model's own with --model-id, else the group's; a model without one follows its group, then the client's default endpoint",
    addClearBaseUrl:
      "Remove the stored base URL: the model's own with --model-id, else the group's",
    addContextWindow: "Context window size (tokens)",
    addMaxTokens:
      "Per-model max output tokens (positive integer); when set it overrides the Agent's max_tokens, omit to inherit — lower it for small-context models",
    addClientType:
      "MMSP client type (openai-responses, ant-messages, openai-chat, google-genai or mmsp, or a vendor's official client such as google-official): the model's own with --model-id, else the group's; a model without one follows its group, else MMSP routes it by id (a new custom or own-group model gets openai-chat when its group sets none); Penguin Go takes mmsp only",
    addClearClientType:
      "Remove the stored client type: the model's own with --model-id, else the group's",
    addVision: "Mark the model as supporting image input (vision)",
    addNoVision: "Mark the model as NOT supporting image input; omit both to keep current",
    addFastMode:
      "Enable fast mode: faster output at premium pricing (models without a fast tier reject requests carrying it)",
    addNoFastMode: "Disable fast mode (the default); omit both to keep current",
    fastModeUnsupported: (ref: string): string =>
      `Warning: ${ref} cannot serve fast mode — MMSP's client for it rejects the parameter, so its requests will fail. Re-run with --no-fast-mode to turn it off.`,
    addPriceCacheRead: "Price per 1M tokens: cache read (USD)",
    addPriceCacheWrite: "Price per 1M tokens: cache write (USD)",
    addPriceOutput: "Price per 1M tokens: output (USD)",
    addSetDefault: "Also set as the Project default model",
    defaultDesc: "Set the Project default model",
    visionDesc:
      "Set the vision model that reads images for non-vision session models (read_file hands images to it)",
    refModelId: "Upstream model id; forms the (provider, model_id) pair reference with --provider",
    refProvider: "Provider group of the referenced entry (see `penguin config model list`)",
    listDesc:
      "List the groups' connections, then the Project's models with the connection each one uses: (provider) marks a group value, (env) an environment key (API keys hidden)",
    removeDesc:
      "Remove a model from the Project (clears the default / vision pointers naming it); without --model-id, remove the group's connection",
    removeModelId:
      "Upstream model id of the entry to remove; omit it to remove the group's connection instead (its models stay)",
    langDesc:
      "Set the interface language (en|zh); persists PENGUIN_LANG to your shell startup file",
    langArg: "Language: en or zh",
    vaultDesc: "Manage an Agent's vault (environment variables injected into its shell commands)",
    vaultSetDesc: "Set a vault environment variable (added or overwritten)",
    vaultListDesc: "List vault environment variables (values masked)",
    vaultRemoveDesc: "Remove a vault environment variable",
    vaultKey: "Variable name (letters, digits and underscores; must not start with a digit)",
    vaultValue: "Variable value, written to the Agent's agent_state/.vault.toml",
  },

  langInvalid: (value) => `Invalid language "${value}". Use en or zh.`,

  langWindowsUnsupported: (lang) =>
    `penguin config lang persists via POSIX shell startup files, which Windows does not have.\n` +
    `Set the user environment variable instead: setx PENGUIN_LANG ${lang} (new terminals pick it up).`,

  langSet: (lang, rcPath) => `Language set to ${lang}; wrote PENGUIN_LANG to ${rcPath}.`,

  langRestartConfirm: () => "Open a new shell now to apply? [y/N] ",

  langRestart: () => "Opening a new shell with the new language (type exit to return)…",

  langRestartHint: (rcPath) => `Open a new terminal, or run: source ${rcPath}`,

  modelAdded: (model, def) => `Added model ${model}. Default model: ${def ?? "(unset)"}`,

  modelUpdated: (model, def) => `Updated model ${model}. Default model: ${def ?? "(unset)"}`,

  defaultModelSet: (model) => `Default model set to ${model}.`,

  visionModelSet: (model) => `Vision model set to ${model}.`,

  modelRemoved: (model, def) => `Removed model ${model}. Default model: ${def ?? "(unset)"}`,

  modelNotConfigured: (model) => `Model ${model} is not in the Project config.`,

  modelNotRoutable: (model) =>
    `Model ${model} cannot be routed: a vendor group routes a model by the vendor prefix its id ` +
    `begins with (gpt-, claude-, gemini-, glm-, kimi-, deepseek-, minimax-). ` +
    `Add it under a custom group (--provider custom) with --client-type and --base-url, ` +
    `or pass --client-type to pin the protocol this model speaks.`,

  modelNotAddable: (model, group) =>
    `Model ${model} cannot be added: the ${group} group carries its built-in models only. ` +
    `Add it under a custom group (--provider custom, or a group name of your own) ` +
    `with --client-type and --base-url.`,

  visionModelCleared: () => "It was also the vision model; that setting is now unset.",

  modelListTitle: () => "Models:",

  modelListEmpty: () => "No models configured yet. Add one with `penguin config model add`.",

  groupListTitle: () => "Groups:",

  modelGroupOnlyFlags: (group) =>
    `--context-window, --max-tokens, --vision, --fast-mode, the --price-* flags and --set-default ` +
    `describe one model: add --model-id <upstream id>, or drop them to set the ${group} group's connection.`,

  providerInvalidGroup: (group) =>
    `Invalid group "${group}": a group name starts with a lowercase letter or digit and uses ` +
    `only lowercase letters, digits, - and _ (at most 32 characters).`,

  providerFlagConflict: (flag, clearFlag) => `${flag} and ${clearFlag} cannot be combined.`,

  providerBlankValue: (flag, clearFlag) =>
    `${flag} is empty. Pass a value, or ${clearFlag} to remove the stored one.`,

  providerInvalidBaseUrl: (baseUrl) =>
    `Invalid --base-url "${baseUrl}": a group's base URL must be a full URL starting with http:// or https://.`,

  protocolFixed: (group, clientType) =>
    `${group}'s protocol is fixed to ${clientType}: --client-type takes ${clientType} only, and the group's protocol cannot be cleared.`,

  providerNothingToSet: (group) =>
    `Nothing to change for group ${group}: pass --api-key, --base-url or --client-type, or one of the --clear-* flags.`,

  providerSaved: (group, overriding) =>
    `Saved the ${group} group's connection; its models without a value of their own follow it.` +
    (overriding === 0
      ? ""
      : overriding === 1
        ? " 1 model sets its own value and is unaffected."
        : ` ${overriding} models set their own value and are unaffected.`),

  providerNoModels: (group) =>
    `Group ${group} has no models yet; the models you add to it will follow this connection.`,

  providerNothingToRemove: (group) =>
    `Group ${group} has no connection to remove. To remove a model, add --model-id <upstream id>.`,

  providerRemoved: (group, models) =>
    `Removed the ${group} group's connection.` +
    (models === 0
      ? ""
      : models === 1
        ? " Its 1 model stays; where it has no value of its own, it now uses the client defaults."
        : ` Its ${models} models stay; the ones without a value of their own now use the client defaults.`),

  vaultSet: (key) =>
    `Saved vault entry ${key}. New conversations pick it up right away; running ones after their next compaction.`,

  vaultRemoved: (key) =>
    `Removed vault entry ${key}. New conversations pick it up right away; running ones after their next compaction.`,

  vaultKeyMissing: (key) => `Vault entry ${key} does not exist.`,

  vaultListTitle: () => "Vault environment variables (values masked):",

  vaultListEmpty: () => "The vault is empty. Add one with `penguin config vault set`.",
};

/** The Chinese half of this contribution's messages. */
export const configZh: ConfigText = {
  config: {
    desc: "管理 Project 配置",
    modelDesc: "管理模型、分组连接信息与默认模型",
    addDesc: "新增或更新一个模型；不带 --model-id 即设置分组的连接信息（API key、base URL、协议）",
    addModelId: "上游模型 id（如 claude-sonnet-4-6，原样发给 MMSP）；不给即设置分组的连接信息",
    addProvider:
      "provider 分组：模型所属的分组，或要设置连接信息的分组；必填，不作推断（无厂商分组时填 custom）",
    addApiKey:
      "API key，存入 Project 的隐藏文件 .project_config.toml：带 --model-id 为该模型自己的，否则为分组密钥（组内没有自己 key、访问分组端点的模型使用它）",
    addClearApiKey:
      "清除已存的 API key：带 --model-id 为该模型自己的（之后改用分组密钥），否则为分组密钥",
    addBaseUrl:
      "base URL：带 --model-id 为该模型自己的，否则为分组的；模型没有自己的即跟随分组，分组也没有即用客户端缺省端点",
    addClearBaseUrl: "清除已存的 base URL：带 --model-id 为该模型自己的，否则为分组的",
    addContextWindow: "上下文窗口大小（token 数）",
    addMaxTokens:
      "该模型的最大输出长度（正整数）；设置后覆盖 Agent 的 max_tokens，缺省沿用——小上下文模型建议调低",
    addClientType:
      "MMSP 客户端协议（openai-responses、ant-messages、openai-chat、google-genai 或 mmsp，或厂商的官方客户端，如 google-official）：带 --model-id 为该模型自己的，否则为分组的；模型没有自己的即跟随分组，分组也没有即由 MMSP 按 id 路由（custom 与自建分组的新模型在分组未设协议时取 openai-chat）；Penguin Go 只接受 mmsp",
    addClearClientType: "清除已存的协议：带 --model-id 为该模型自己的，否则为分组的",
    addVision: "标注该模型支持图片输入（视觉）",
    addNoVision: "标注该模型不支持图片输入；两者都不给则保留原值",
    addFastMode: "开启快速模式：输出更快、按溢价计费（不支持 fast 档位的模型会拒绝请求）",
    addNoFastMode: "关闭快速模式（缺省即关闭）；两者都不给则保留原值",
    fastModeUnsupported: (ref: string): string =>
      `警告：${ref} 不支持快速模式——MMSP 为它选用的 client 会拒绝该参数，其请求都会失败。请用 --no-fast-mode 重新执行以关闭。`,
    addPriceCacheRead: "每百万 token 价格：缓存命中（USD）",
    addPriceCacheWrite: "每百万 token 价格：缓存未命中（USD）",
    addPriceOutput: "每百万 token 价格：输出（USD）",
    addSetDefault: "同时设为该 Project 的默认模型",
    defaultDesc: "设置 Project 的默认模型",
    visionDesc: "设置代读图片的视觉模型（不支持图片的会话模型用 read_file 读图时由它代读）",
    refModelId: "上游模型 id；与 --provider 构成 (provider, model_id) 成对引用",
    refProvider: "引用条目的 provider 分组（见 `penguin config model list`）",
    listDesc:
      "先列各分组的连接信息，再列当前 Project 的模型及其生效的连接信息：(provider) 标出取自分组的值，(env) 标出来自环境变量的 key（API key 隐藏）",
    removeDesc:
      "从当前 Project 删除一个模型（指向它的默认模型 / 视觉模型设置一并清空）；不带 --model-id 即移除分组的连接信息",
    removeModelId: "要删除条目的上游模型 id；不给即只移除分组的连接信息（组内模型保留）",
    langDesc: "设置界面语言（en|zh）；将 PENGUIN_LANG 写入 shell 启动文件并持久化",
    langArg: "语言：en 或 zh",
    vaultDesc: "管理 Agent vault（注入该 Agent shell 命令的环境变量）",
    vaultSetDesc: "写入一个 vault 环境变量（不存在则新增，存在则覆盖）",
    vaultListDesc: "列出 vault 环境变量（值掩码显示）",
    vaultRemoveDesc: "删除一个 vault 环境变量",
    vaultKey: "变量名（字母、数字与下划线，不能以数字开头）",
    vaultValue: "变量值，写入该 Agent 的 agent_state/.vault.toml",
  },

  langInvalid: (value) => `无效的语言 "${value}"。请使用 en 或 zh。`,

  langWindowsUnsupported: (lang) =>
    `penguin config lang 通过 POSIX shell 启动文件持久化语言，Windows 上没有对应机制。\n` +
    `请改为设置用户环境变量：setx PENGUIN_LANG ${lang}（新终端生效）。`,

  langSet: (lang, rcPath) => `语言已设为 ${lang}；已将 PENGUIN_LANG 写入 ${rcPath}。`,

  langRestartConfirm: () => "现在打开新 shell 使其生效？[y/N] ",

  langRestart: () => "正在打开使用新语言的新 shell（输入 exit 可返回）……",

  langRestartHint: (rcPath) => `请打开新终端，或执行：source ${rcPath}`,

  modelAdded: (model, def) => `已添加模型 ${model}。当前默认模型：${def ?? "(未设置)"}`,

  modelUpdated: (model, def) => `已更新模型 ${model}。当前默认模型：${def ?? "(未设置)"}`,

  defaultModelSet: (model) => `默认模型已设为 ${model}。`,

  visionModelSet: (model) => `视觉模型已设为 ${model}。`,

  modelRemoved: (model, def) => `已删除模型 ${model}。当前默认模型：${def ?? "(未设置)"}`,

  modelNotConfigured: (model) => `模型 ${model} 不在当前 Project 配置中。`,

  modelNotRoutable: (model) =>
    `模型 ${model} 无法路由：厂商分组按模型 id 开头的厂商前缀` +
    `（gpt-、claude-、gemini-、glm-、kimi-、deepseek-、minimax-）路由。` +
    `请改用自定义分组（--provider custom）并附上 --client-type 与 --base-url，` +
    `或用 --client-type 指定该模型所用的协议。`,

  modelNotAddable: (model, group) =>
    `模型 ${model} 无法添加：${group} 分组只承载内置模型。` +
    `请改用自定义分组（--provider custom，或自己命名的分组）并附上 --client-type 与 --base-url。`,

  visionModelCleared: () => "它同时是视觉模型，该设置已一并清空。",

  modelListTitle: () => "模型：",

  modelListEmpty: () => "尚未配置任何模型。用 `penguin config model add` 添加。",

  groupListTitle: () => "分组：",

  modelGroupOnlyFlags: (group) =>
    `--context-window、--max-tokens、--vision、--fast-mode、各 --price-* 选项与 --set-default 只描述单个模型：` +
    `请加上 --model-id <上游 id>，或去掉它们以设置分组 ${group} 的连接信息。`,

  providerInvalidGroup: (group) =>
    `分组名「${group}」无效：分组名以小写字母或数字开头，只含小写字母、数字、- 与 _，长度不超过 32。`,

  providerFlagConflict: (flag, clearFlag) => `${flag} 与 ${clearFlag} 不能同时使用。`,

  providerBlankValue: (flag, clearFlag) =>
    `${flag} 为空。请给出取值，或用 ${clearFlag} 清除已存的值。`,

  providerInvalidBaseUrl: (baseUrl) =>
    `--base-url「${baseUrl}」无效：分组的 base URL 须为以 http:// 或 https:// 开头的完整地址。`,

  protocolFixed: (group, clientType) =>
    `${group} 的协议固定为 ${clientType}：--client-type 只接受 ${clientType}，分组的协议也不能清除。`,

  providerNothingToSet: (group) =>
    `分组 ${group} 没有要修改的内容：请给出 --api-key、--base-url 或 --client-type，或其中某一项的 --clear-* 选项。`,

  providerSaved: (group, overriding) =>
    `已保存分组 ${group} 的连接信息，组内没有自己设置对应项的模型随之使用。` +
    (overriding === 0 ? "" : `另有 ${overriding} 个模型单独设置了对应项，不受影响。`),

  providerNoModels: (group) =>
    `分组 ${group} 下还没有模型；之后添加到该分组的模型将跟随这份连接信息。`,

  providerNothingToRemove: (group) =>
    `分组 ${group} 没有可移除的连接信息。要删除模型，请加上 --model-id <上游 id>。`,

  providerRemoved: (group, models) =>
    `已移除分组 ${group} 的连接信息。` +
    (models === 0 ? "" : `组内 ${models} 个模型保留，没有自己设置对应项的模型改用客户端缺省。`),

  vaultSet: (key) => `已保存 vault 条目 ${key}。新对话立即生效；进行中的对话在下一次压缩后生效。`,

  vaultRemoved: (key) =>
    `已删除 vault 条目 ${key}。新对话立即生效；进行中的对话在下一次压缩后生效。`,

  vaultKeyMissing: (key) => `vault 条目 ${key} 不存在。`,

  vaultListTitle: () => "vault 环境变量（值已掩码）：",

  vaultListEmpty: () => "vault 为空。用 `penguin config vault set` 添加。",
};
