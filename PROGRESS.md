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

- 验证轮修复（owner 读数）：library/auth/src/reset-admin-password.ts 的 "./auth/password.js"
  与 "./auth/service.js" 改 "./password.js"/"./service.js"（S21 机械改路径漏改的两处）；
  顺手全 library+server 相对 import 可解析性扫描，另揪出同病一处——
  library/plugin/src/icon-response.ts 原 http/ 目录内 "./errors.js" 改
  @prismshadow/penguin-library-http/errors。其余 9 条扫描命中均为误报（json/模板字符串/
  shim/index）。

- 重基（owner 直令）：rebase onto origin/main 93b9d50562（落后 19 笔），19/19 零冲突。
  重命名侧合并逐文件核验：builtin-market.json/builtin-index.json/preinstall.ts/
  system-app-modules.ts/install.ts/module-rule.ts 与 main 版一致（#1873 钉版语义折进
  搬移后文件）；registry/offline-archives/market/loader/host 五处 DIFF 仅端口形态替换行；
  api/types.ts main 侧 19 笔内零净代码改动；server package.json 只剩字母序 churn＋
  我们的 plugin/safe-regex；market.mjs 除路径行外与 main 零差异。changelog 三对双语
  （organization-runtime/auth/plugin）重基后在位。
- lockfile：重基合并产物为混合态（旧 rc URL＋新钉版 URL 并存；server 快照残留
  first-workbench-guide 孤儿行——#1841 已在 main 删插件与全部引用，重基自动合并把
  旧 base 侧快照行带了回来）。pnpm 11.18.0 全量重生成收敛为钉版一致态（github.com
  tarball 计数 140＝main 一致）；孤儿行 pnpm 懒重生成不剪，手工删 1 行后复跑重生成
  验证为不动点（diff 恰 1 删，孤儿不回）。messaging→observability/project 的
  link→file 翻转是 pnpm 对本树的真实输出（S20 新增 organization 造成
  messaging/project/organization workspace 环，pnpm 对环上边用带 peer 后缀的 file
  实例；main 无 organization 故无此环），保留不手改。重生成 WARN 两条环依赖
  （agent-api/session/http/auth；messaging/project/organization）留观。

- 验证轮修复 2（owner land 读数）：A 类 esbuild 3 条——platform.ts、http/routes/plugins.ts、
  http/routes/plugin-market.ts 三处 mirror-settings 相对导入改指
  @prismshadow/penguin-library-plugin/mirror-settings（face 两符号 indexMirrorRules/
  PluginMirrorSettings 均在）；server tsconfig paths 补 mirror-settings 映射（exports 47
  子路径里唯一缺的一条，DTS 免摸陈旧 dist）。全 server src 不可解析相对导入复扫净额
  0（workbenches 三命中为模板字符串里的代码文本，非导入）。B 类 DTS 14 条 TS2304——
  无 from 本地再导出块（约 1420–1555）要求名单在本地绑定：organization/types 导入扩
  6 个 Org 名（face 已导出），新增 plugin/types 导入绑 7 名（AgentAuthor/SkillMetadataItem/
  AgentMcpServerItem/HookItem/PluginConfigEntry/UnsatisfiedPlugin/PluginModuleStatus，
  face 均已导出），原 from 再导出块不动、无双导出。

- 验证轮修复 3（owner land 读数 2）：① scripts/market-covers.mjs MARKET_COVERS_SOURCE 改
  "library/plugin/src/market-covers"——四消费方全走常量（server tsup.config.ts onSuccess、
  desktop build-assets.mjs、scripts/deploy.mjs、sync-market-assets.mjs），一处改全好；
  注释段同步改指 library 面。成类扫出同字面量净额并一并修净：sync-market-assets.mjs
  文档写入目标是活代码硬编码旧路径（join "packages/server/src/plugin/builtin-market.json"，
  release-prep 会把文档复活写旧址）改 library 面；ui-gallery fixtures 的 covers
  import.meta.glob／取用键／注释同病（旧目录静默空集靠 fallback）改净。全仓
  'server/src/plugin/market*' 字面量复扫 0。② landing market.mjs EMBEDDED_MARKET_DOC
  三级上跳在 vite 把 config 链（hub-plugin.ts→published.mjs→market.mjs）打成 .vite-temp
  timestamp 单文件后落到 packages/ 而非仓根——改为从 import.meta.url 向上找
  pnpm-workspace.yaml 作仓根再 join library/plugin/src/builtin-market.json；直跑与打包
  两形态实测解析同一路径且文件在（.vite-temp 探针模拟打包位）。同链 source.mjs 的两级
  上跳在 .vite-temp 位恰好落点不变未动；hub.mjs 的 createRequire 不在打包链。

- 验证轮修复 4（web 编译红，总调度确诊）：server api/types.ts:2880 的 value 再导出
  export { SESSION_COOKIE } from .../auth/middleware 使 web bundle 经
  @prismshadow/penguin-server/api 拉入 middleware dist，链上 media-type→node:util 被
  vite 打桩报 "MIMEType" is not exported。修＝纯挪位、face 不变：library/auth 新增
  src/cookie-name.ts（零 import 落常量），middleware.ts 改
  export { SESSION_COOKIE } from "./cookie-name.js"（导出面不变，server shim
  export * 仍成立，own-origin/cli-commands 的 type 导入不受影响），package.json
  exports +./cookie-name、tsup entries +src/cookie-name.ts，server types.ts:2880 改指
  cookie-name face，server tsconfig paths 补映射（auth-token 与 initial-password 之间，
  字母序）。types.ts 其余三条 value 再导出（TICKET_SLUG_PATTERN/HOST_COMMANDS/
  AVATAR_MAX_CHARS）web 构建未红，不扩面。
- 验证轮修复 4 补：auth DTS 红为上一步自身引留——middleware.ts 的
  export { … } from 再导出不产生本地绑定，而本文件 44/53 行仍用 SESSION_COOKIE
  （TS2552 ×4）。改 import { SESSION_COOKIE } from "./cookie-name.js" +
  export { SESSION_COOKIE }; 两行，绑定与导出面同时在。教训与 types.ts 14 名同坑：
  再导出无本地绑定。
