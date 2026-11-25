# G3 restack S20–S22 — 进度与分支头

- 组分支：restack3/S20-S22（base origin/main ae7390398f）
- 工作树：/home/kamiyoru/work/ts/restack3-g3
- 验证通道：vps push / vps compile / vps wt sh -c / vps test（禁整段 lease）

## 当前分支头（owner 轮询取这里）

**restack3/S20-S22 @ 298817eda7**（S20 代码全部落地，验证被 lockfile 阻塞，见下）

## BLOCKER（候 owner 集中处理）

lockfile 过期：library/organization 新增 13 个依赖（workspace 包 ×10 ＋ hono/smol-toml/yaml），
pnpm-lock.yaml 未含。后果与已试路径：

1. `vps compile penguin 298817eda7` → install 步 `ERR_PNPM_OUTDATED_LOCKFILE`（frozen-lockfile
   拒，--frozen 是 CI 默认）。install 失败后 build 用旧 node_modules 顶到 tsup 报
   TS2307（Cannot find module '@prismshadow/penguin-library-project'）——非代码错误。
2. 简单形状的构建机 scratch 重生成（clone → pnpm install --lockfile-only → 经
   restack3-g3-lockregen 分支拉回）被命令分类器拒。
3. 未手工编 lockfile。

**请集中处理**：以 restack3/S20-S22 @ 298817eda7 的 package.json 重生成 pnpm-lock.yaml，
提交到 restack3/S20-S22（或告知落点）。lockfile 落地后即可跑 compile → wt 三件套 → 双套件。

## 时间线

- 2026-11-24：S20 主体提交 7ac1affb12（organization 9 文件＋runtime 11 文件＋deletion＋路由工厂
  → library/organization；契约 DTO → library/organization/types 与 library/agent/types；
  SEMANTIC_ID_PATTERN → core；server 侧 shim＋module.ts 装配＋OrgRoutes 绑端口；org-harness 补
  semanticId 端口）；changelog 双语；deps/schedules 子路径修正；routes.ts 重切修复。
- 分支头 298817eda7；compile 记录：install frozen 拒 ×2（1e159423f1 时代实际缺依赖到 build 才炸，
  298817eda7 起 install 即拒）。
- S20 待验证（lockfile 落地后）：vps compile → vps wt 三件套（pnpm -r typecheck / oxlint /
  prettier --check）→ vps test server+cli。
- S21 auth：实现进行中（见下）。S22 plugin：排后。

## S20 落图（备 owner 验证）

- 搬入 library/organization：avatars/files/handbook/names/paths/principal/store/ticket-id/zoned、
  runtime/{service,deps,budget,digest,locks,model,notices,reconcile,rota,scheduler,triggers}、
  organization-deletion、routes（工厂）；契约 types.ts（Org DTO 段＋Employment/UnreadableChart）。
- library/agent/types.ts 增 AgentDeletionInfo/AgentDeleteResponse/AgentDeletionResponse。
- core state/ids.ts 增 SEMANTIC_ID_PATTERN；server services/ids.ts 改再导出。
- server 留装配：runtime/organization/module.ts（deps 端口绑定，含 semanticId 端口闭合
  SEMANTIC_ID_RULES/suggestSemanticId/isNewSemanticId）、http/routes/organizations.ts（OrgRoutes
  绑 agentDeletion 端口）；其余路径全部薄 shim。
- OrgRuns/OrgSessions/OrgScheduler/OrgService 契约 @Interface() 形逐成员照搬实现，default 参数
  写可选等价。

## S22 落图（2026-11-24，实现完成，验证候 lockfile）

- 新建 `library/plugin`（@prismshadow/penguin-library-plugin）：git mv plugin/ 全部 35 个 .ts
  ＋builtin-index/builtin-market.json＋market-covers/ 资产、services/{plugin-archive,
  plugin-library,plugin-modules,plugin-server-uninstall,plugin-tables,plugin-uninstall,
  preinstall-once}、http/icon-response.ts、mechanisms/plugins.ts→mechanisms.ts。
- 契约：api/types.ts 的 plugin DTO 闭包 66 个声明（34 个种子＋传递依赖，含 McpTransport/
  HookItem/SkillMetadataItem/IconRef 及 plugin 契约引用的 agent-create/task-create 形状）切到
  library/plugin/src/types.ts（1233 行）；api/types.ts 改 re-export（66 名单）。闭包脚本核对：
  before 290 decl → after 224，一一对应，无缺漏。
- 端口（library/plugin/src/ports.ts）：unpackedAssetsDir＋platformIfaceTable＋isDevProfile
  （loader/typescript/market-covers/offline-archives 用，server plugin/platform-ports.ts 绑定，
  四个 shim import 即绑）；PluginUninstallWorkbenches（remove＋notFound，admin-plugins/plugins
  路由经 pluginUninstallWorkbenches() 包装）；OwnTableListing（listInOwnTable＋UnparseableConfig，
  preinstall-once shim 绑定）；PluginModulesService 的 config/hmr/reassembly/channels(peekUser)/
  log/clock 端口＋db 用 library-db 的 Db。readManifest 直取 @prismshadow/penguin-hmr/manifest
  （server hmr/manifest.ts 本就是它的 re-export）。
- 留 server：plugin/index.ts（barrel）、plugin/views.ts（MachineApi 类型依赖）、
  plugin/cli-commands.ts（Provider：@Use hmr/db 是服务端能力；契约/slot/路由/run 机制搬
  library/plugin/src/cli-commands.ts，server 文件 re-export＋Provider）、services/own-table-listing.ts
  （依赖 project-config-migrations→model-catalog，链太深，走端口）。
- 装配：services/plugin-modules.ts 重写为 PluginModulesServiceProvider（Object.assign 绑 14 个
  端口，peekUser 组合 channels.peek(userChannelKey(userId))，绑后调 service.setup()）；
  platform.ts 注册换 Provider。checkoutRoot 移 library/plugin/src/checkout-root.ts（cli-shim
  保留内部使用，改从 library import；cli-shim.test.ts 改 import）。
- 全部旧路径薄 shim（plugin/ 30 个＋services/ 6 个＋icon-response＋mechanisms/plugins）；
  hmr/platform.ts（红线内）对 plugin/host、loader、unsatisfied、install、library-host 的 import
  经 shim 原样可用，未动 hmr 一字。
- package.json：library/plugin deps（core/hmr/auth/db/http/machine/messaging/project/session/
  setting ＋ commander/fflate/hono/minimatch/safe-regex/smol-toml/tar/which）＋46 个 exports
  子路径；tsup 47 entries；server package.json 加依赖；server tsconfig 加 46 映射。
- changelog 双语 changelog/unreleased/2026-11-24-library-plugin.md/.zh.md。
- lockfile：新包再添依赖，与 S20/S21 同候 owner 集中重生成。

## 时间线（续）

- S22 头：本提交；三片齐后分支头即 PR3 的 head。
