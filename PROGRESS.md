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
- 验证轮修复 4 补 2：ui-gallery build 红——fixtures.ts 的 builtin-market.json 导入与
  covers glob 取 4 级上跳（14a28d263c 沿用了旧 server 路径的 4 级；library 在仓根需要
  5 级，本文件 73 行 node_modules/.cache 的现成 5 级可证），server test
  plugin-market.test.ts 同字面量在 packages/server/test/ 只需 3 级。四处全按各自深度
  修净（python normpath 机械复核落点）。上轮 compile 读数：web 包已绿（cookie-name
  达效）、auth DTS 过、desktop 过。
- 验证轮修复 5（server 套件 349/349 文件红，单根因）：bound TDZ 环——platform-ports.ts
  为取 WorkbenchNotFound 引 workbenches/service.js，service 求值途中经 typescript.js
  回到 platform-ports 并在模块顶跑 ensurePluginPlatformPorts()，此时 platform-ports
  体未到 let bound（TS/ESM 循环求值暂停点）。破环选运行时依赖最小边：WorkbenchNotFound
  下沉新叶模块 workbenches/errors.ts（自述零依赖），service.ts import＋原位
  export { WorkbenchNotFound }（导出面不变，routes.ts 的组合导入与 instanceof 语义不动），
  platform-ports.ts 改引 errors.js。platform-ports 传递闭包复核全叶（library ports、
  node-only asset-archives、core+leaf profile、errors、json、kernel type）——四 shim
  的 import 即绑从此无再入路径。hmr 红线未触碰（asset-archives 仅读）。
- 验证轮修复 6（server 套件二轮：213 文件红单根因）：gen-ifaces 的 iface 表按名字归并，
  ports.ts 给 PluginModulesService 声明的端口面 PluginConfig（fields.root，server 的
  Config 结构性满足）与 config.ts 的内核 iface PluginConfig（get/watch/saved/schema，
  settings store 的 api 面）撞名，生成表被端口版占据，PluginConfigProvider 的 store
  校验报 missing [root]，createTestApp 全数起不来（afterEach 的 t.cleanup 掩盖主错）。
  main 无 ports.ts 故无撞名。修＝端口类改名 PluginProcessConfig（iface 名即类名；
  绑定按属性名 config 走 Object.assign，不受影响），plugin-modules.ts 类型标注同步；
  内核面 PluginConfig 恢复本名独占，回到 main 的表形态。仅 library 两文件，server 零改。
- 验证轮修复 7（server 套件三轮主错换岗）：organization module.ts 把 OrganizationService
  放在 import type 块里却在 setup() 中 new 它——tsup 的 esbuild 不做类型检查，type-only
  擦除后 dist 裸标识符报 ReferenceError（tsc typecheck 能抓而 land 的 compile 不跑
  typecheck）。改值导入，OrgScheduler/OrgService 仅类型位保持 type-only。成类扫描
  （new/instanceof 对 import type 名）server src 除本例外净 0（terminal-relay 的
  WebSocket 命中为别名误报，25 行本有 ws 值导入），library＋cli 净 0。上轮读数：
  PluginConfigProvider root 红已随端口改名消失。
- 验证轮修复 8（server 套件四轮主错：No plugin library）：setup 文件与配置都在——
  test/setup/library-host.ts 存在、vitest.config.ts:105 setupFiles 列有它、且第 16 行
  确调 useLibraryHost(serverPackageDir())，但 namedHost 仍为空。根因＝9377badf4d（S22
  plugin→library 搬域）把 serverPackageDir 实现随域搬进 library/plugin/src/library-host.ts，
  而它的找法是「以调用传入的目录为起点向上最近一个 package.json，name 必须是
  @prismshadow/penguin-server，否则 null」（第一个 package.json 不匹配即返回，不续走）。
  原实现位于 server 包内所以起点即命中；搬移后默认起点变成 library/plugin 包自己的
  目录（vitest 解析到注入拷贝 dist/library-host.js，import.meta.url 在
  packages/server/node_modules/@prismshadow/penguin-library-plugin/dist/），向上第一个
  package.json 是 penguin-library-plugin 自己的 → 恒 null → useLibraryHost(null) →
  findHost 两个锚点（LOADER_DIR=packages/core/dist 向上、vitest worker 向上）均无
  @penguinharness/ 依赖 → hostPackage 缓存 null 并 throw「No plugin library」。main 绿
  正因旧位置成立——这是 restack 搬域引入的真回归，不是测试基建自身的洞。佐证：server
  package.json dependencies 命名全部 @penguinharness/* 插件包（94 行起），namedHost 一旦
  命中链路即通；core hostPackage() 的 null 会被缓存（host===undefined 才重算）。
  修＝server 侧转发文件 packages/server/src/plugin/library-host.ts 显式定义
  serverPackageDir() 包装：以本文件（server 包内）的 import.meta.url 为起点调用 library
  侧实现；checkout（src/plugin/ 向上）与 npm 安装（dist 向上）都命中 server 的
  package.json，desktop/热推 bundle 场景仍按原设计返回 null（pushed library 或 bundling
  package 兜底）。保留 export * 转发其余符号（本地导出按 ESM 规范遮蔽同名 star 导出），
  hmr/platform.ts 与 test/setup/library-host.ts 两个调用方零改动。hmr 红线未触碰。
  提交 c5c3f6beef（身份已核 Myriad-Dreamin）。待 land 读数。
- 验证轮修复 9（63 文件级红的主错，两轮试错后定位真机制）：c5c3f6beef 后读数 213→63
  （seedAdmin/provision 链恢复，经 vite 图 core），剩 63 文件全挂在 createAgent →
  DiskPluginLibrary.defaultInstalled。机制＝双注册表：server src 静态 import 的
  penguin-library-plugin 是注入快照（server/node_modules 内 symlink → .pnpm 的
  file: 物理拷贝；core 则是 symlink → packages/core 源目录），vitest 对快照
  externalize → Node 原生加载其 dist → dist 的 core import 从快照树解析到 .pnpm 的
  core 物理拷贝（readlink 实证 PHYSICAL）→ 与 vite 图的 packages/core 是两个注册表
  ＋两个物理文件，setup 命名的 host 对快照那份不可见。两轮尝试证伪：inline
  penguin-library-plugin（34eb4b2773）读数不变——dist 虽被 transform，其 core import
  externalize 仍落快照拷贝；21 条 alias 指各 library src（97b0bcac3f）读数不变——
  src 进了 vite 图，但 src 的 core import externalize 由 Node 从 src 位置解析，
  与 vite 图 core 仍是两个注册表（同物理文件也分表）。快照物理拷贝这道墙任何
  resolve 侧手法都跨不过。真修＝test/setup/library-host.ts 在 Node 视角也命名：
  createRequire 定位 library-plugin 快照真实目录（require.resolve 经 symlink 落
  .pnpm），再从快照 package.json 建 require、require(esm) 拿快照树内的 core
  （与 dist 内 import 的 node_modules walk 同起点、同 real-path URL、同 Node ESM
  实例），对它调 useLibraryHost(serverPackageDir())；try/catch 兜底（无快照形态
  时图内实例已被命名）。同时回退 alias 与 inline 两处无效改动，vitest.config.ts
  恢复 c5c3f6beef 形态，交付面保持最小。hostPackage 链的快照侧消费方全仓仅
  library-module.ts 一处，已核。
- 验证轮修复 10（修复 9 的 require(esm) 被 core exports 封锁，改绝对路径直指快照 core 的
  dist 文件）：vps 探针实证 createRequire(...).require("@prismshadow/penguin-core") 抛
  ERR_PACKAGE_PATH_NOT_EXPORTED——core 的 exports 只有 import 条件、无 require，且无
  ./package.json 子路径导出（裸名 resolve 同样会被挡），setup 的 try 块整段被 catch 吞掉
  → 快照 core 从未被命名，读数因此纹丝不动。exports 映射只约束裸 specifier，绝对文件
  路径的 require 完全绕开它；core exports "." 的 import 落点即 dist/index.js，故
  snapshotRequire(join(dirname(插件 package.json), "..", "penguin-core", "dist",
  "index.js")) 与快照 dist 内 import 的解析落点是同一物理文件 → 同 real-path URL →
  同 Node ESM 实例。路径推导：pnpm file: 拷贝把插件直接依赖平铺在同一 node_modules
  层，core 拷贝是插件包目录的同级（../penguin-core）。只改 library-host.ts 的 require
  目标与注释，import 补 node:path。待 land 读数。
- 验证轮修复 11（修复 10 后 63→22 文件红，"No plugin library" 0 次；新主错＝测试 push 的
  fixture 库与跨拷贝 instanceof）：28 处 POST 安装 404（unknown_plugin）——plugin-fixtures
  等测试侧从 vite 图 core 调 usePushedPluginLibrary/useInstalledPluginPrefix，而路由持有的
  DiskPluginLibrary 读快照 core 的状态 → fixture 不可见；另有 ModuleBootError 未被判为
  UnsatisfiedPluginsError、404 应为 409（routes catch 的是 server 侧类，throw 的是快照侧
  类）——状态与类身份双双跨拷贝失配，桥接状态盖不住，必须整体坍缩注册表。修＝
  vitest.config.ts 把第二轮 alias 清单（19 个 library 包 → src 目录）恢复，并补上它缺的
  两条：core 裸名 → packages/core/src（library src 的 core import 不再 externalize，
  第二轮正是缺这条所以读数纹丝不动）与 penguin-hmr → packages/hmr/src（config 只指路，
  hmr 文件零改动，红线未触碰）；core 两个非镜像子路径（/plugin-index → src/plugin/
  index-document.ts、/model-connection → src/state/model-connection.ts）显式条目并排在
  裸名之前（alias 按序首匹配，裸名的前缀语义会吞掉它们）。全部 19 包子路径落点已程序化
  核验（唯一非镜像的就是 core 那两条）；theme-pack/ui 维持 inline 不 alias（它们的
  /chat-markdown、/pack-rules 非镜像，inline 链已工作）。待 wt 单文件快测后 land 读数。
- 验证轮修复 12（注册表坍缩后 22→5 文件红，五个红文件分四类）：①themes 11 例＝本轮新引
  入——setting alias 进图后其 theme-pack import 走快照物理拷贝（inline regex 匹配但物理
  路径不同，vite 按 real path 视作两个模块记录）→ 两份 ThemePackError → routes instanceof
  失配 → 500 非 400；修＝config 补 theme-pack/ui alias（ui 的 /chat-markdown、/pack-rules
  非镜像子路径显式条目排在裸名前，落点 src/markdown/index.ts、src/testing/pack-rules.ts）。
  ②plugin-cdn-failover 整文件红＝测试还在 import 已搬走的 ../src/plugin/mirror-settings
  （server 侧无转发文件，搬域时漏改），改用库包 specifier。③organization-runtime 6 例＝
  restack 把服务搬进 library 并引入必填 deps.semanticId（boot 在 runtime/organization/
  module.ts:118 绑定），测试 deps 没绑 → suggest undefined；修＝测试 beforeEach 照 boot
  形状绑定真实 suggestSemanticId+SEMANTIC_ID_RULES+isNewSemanticId（行为断言走的正是这个
  共享 suggester 的 prompt/NO_MODEL 语义）。④sandbox-settings 4 例与 plugin-source-settings
  1 例待本轮修后单文件定位。提交 fc96888a24 之后的增量。
- 验证轮修复 13（五文件定向快测：themes/organization-runtime/plugin-cdn-failover 三文件
  转绿，剩 sandbox-settings 4 例＋plugin-source-settings 1 例）：①sandbox-settings 根因＝
  测试 manifest 里的接口 id 字符串 "@prismshadow/penguin-server#PluginConfig" 过期——接口
  类已随搬域落进 library/plugin（@Interface() 声明在 config.ts:834），id 按声明包推导为
  "@prismshadow/penguin-library-plugin#PluginConfig"，平台报 'config' names interface …
  which the table does not carry → test-backend/probed-backend 两个模块整代剔除 → 无
  sandbox backend（其余三个文件的三类修法各自生效已证）。修＝两处 iface 字符串改为库包
  前缀（33/322 行）。②plugin-source-settings 的 npm registry 断言＝npmReason 取 stderr
  首条长行，而 vps 环境 ~/.npmrc 含 npm 不认识的键（"Unknown user config network…"），
  warn 行抢在 error 行前 → 消息不含 registry.invalid；修＝npmReason 过滤 npm warn 噪声行，
  理由优先取 error 行，只剩 warn 时落 err.message（命令行带 --registry 仍点名）。待快测。
- 验证轮修复 13①判定（调度席转达 G1 评审先例后重判）：PluginConfig 键判 plugin-facing——
  gen-ifaces 以声明包名推导键（moduleNameOf(file)#Class），带方法的 @Interface() 类投影为
  { iface: "<module>#<Name>" } 进接口表（packages/core/bin/gen-ifaces.mjs:47/511 区域）；
  消费面＝平台文档明言"插件的 manifest 以 PluginConfigModule 为 config 来源"
  （packages/server/src/platform.ts:462、plugin/index.ts 的 <module>#<Export> 契约），
  插件 manifest requires.config.iface 按此键点名。搬域把键从
  @prismshadow/penguin-server#PluginConfig 改成 @prismshadow/penguin-library-plugin#…＝
  改了插件面契约。正修＝钉键（@Interface(key?) 显式键＋gen-ifaces 与运行时同尊），
  夹具字符串还原基线，不改字符串迁就。
- 验证轮修复 14（按钉键正修重落修复 13①）：机制照 G1 M1 形状在分支自落——core
  kernel/markers.ts 的 Interface() 加可选 key 参数（@Interface("<module>#<Name>")，
  运行时 no-op 不变，纯声明）；core bin/gen-ifaces.mjs 加 ifaceKeyBySymbol 收集遍历
  （装饰器首参须字符串字面量且含 #，否则拒绝）并让 keyOf 先查显式键再落默认推导，头注释
  同步；运行时零改动（boot 检查与插件 loader 消费的 ifaceTable 就是生成物，hmr
  platform.ts:72 静态 import）。PluginConfig 在 library/plugin/src/config.ts:834 钉回
  @prismshadow/penguin-server#PluginConfig；sandbox-settings 两处夹具字符串还原基线。
  全仓审计：本分支仅此一键搬家（ProjectModelRequests 仍在 server、WorkflowHost 仅存在于
  专测拒绝行为的迁移夹具，无类属预期）。npmReason 的 warn 过滤（修复 13②）不变。
- 调度席更正后裁定（2026-11-26）：更正确认键随声明包走、测试字符串跟表自洽，钉键非必需；
  但钉键保留——外部已发布插件按基线文档点名 @prismshadow/penguin-server#PluginConfig，
  无钉则本分支发布后其 manifest 被 check 整代剔除（平台哲学明载兼容旧插件面），机制为
  生成器侧静态投影、零运行时成本，故保留 d9bc8f1d31 的钉键与基线夹具字符串。
- 验证轮修复 15（钉键机制的第二个推导点）：gen-ifaces 有两条键路径——keyOf（已钉）与
  ifaceKeyOfType（@Use/@Provide 字段的类型投影，1249 行直接 moduleNameOf 推导，绕过
  keyOf）。快测证据：表 ifaces 节已带钉键（penguin-server#PluginConfig 1 处），但
  PluginConfigProvider/PluginConfigPage/PluginSourceSettings 等平台自有节点的
  @Provide() pluginConfig!: PluginConfig manifest requires 仍写库前缀键 → '…which the
  table does not carry' → 模块树整树拒绝（ModuleBootError 7 行）。修＝ifaceKeyOfType
  尾部同样先查 ifaceKeyBySymbol。grep 全文件确认其余 moduleNameOf 推导点仅剩
  namedKeyOf（数据类型 $ref，无接口类语义）与 component 键（不受影响）。
- 全绿（land ok，54628ca9bc）：Test Files 348 passed | 1 skipped (349)、0 失败、
  "No plugin library" 0 次，Duration 409s。读数演进：349 红文件 → 213 → 63 → 22 → 5 → 0。
  本轮（第九层起）四笔：229167df36 setup 绝对路径 require 快照 core 的 dist/index.js
  （require(esm) 被 exports 封锁的绕法）；fc96888a24 vitest alias 全库坍缩注册表（19 库包
  +core+hmr，core 两个非镜像子路径显式钉位）；9d30844548 theme-pack/ui alias＋
  cdn-failover 改库包 specifier＋organization-runtime 绑定 deps.semanticId；
  4da1314adb+54628ca9bc PluginConfig 接口钉键机制（@Interface(key?)＋gen-ifaces 双推导点
  尊重显式键）＋npmReason 过滤 npm warn 噪声。hmr 红线零触碰（gen-ifaces/markers 属 core，
  config 仅指路不修改 hmr 文件）。待同步镜像并报 owner。
- 收尾验证（调度席安排的五步）：①镜像 push（nothing new → --full 成功）②COMPILE_RC=0
  （174bb93bff，DTS/esbuild 全件）③三件套首跑三红——TC_RC=2：browser-automation 的
  typecheck 报 plugin-modules.ts(60) 'setup' does not exist on PluginModules（搬域后抽象
  类无 setup 成员，Object.assign 后赋给抽象类型字段再调用丢失收窄；修＝局部变量先 setup
  再赋字段，行为等价）——LINT_RC=1：runtime/organization/module.ts 两处
  penguin-library-project 重复 import（修＝合并，Member 系列与 AgentIndex 并入一条）；
  FMT_RC=1：26 文件格式漂移（搬域未过 prettier＋我改的 library-host/organization-runtime/
  vitest.config）。④⑤待三件套转绿后连跑。
- FMT 修复（wt 通道）：本地无 prettier，按构建机产物流程走——wt 快照内 prettier --write
  26 文件 → git diff 打包 gzip+base64 回传（19508B，本地解码校验字节后 git apply，25 文件
  +244/−637）。随本笔提交，三件套重跑待 COMPILE_RC。
- TC 收敛过程：browser-automation 修好后 pnpm -r 递归才推进到 packages/server，暴露修复
  13③ 的类型面问题——绑定写在 deps 字面量之后，字面量按 OrgDeps 检查仍缺必填 semanticId；
  修＝移进字面量内（boot 同形）。此前 r2 只见一个错的原因＝pnpm -r 首败即停，后续项目未跑。
- 收尾读数（调度席五步，全部绿）：①镜像 push（--full）②COMPILE_RC=0（DTS/esbuild 全件，
  4a6829a1d7）③三件套 TC_RC=0 / LINT_RC=0 / FMT_RC=0（收敛三笔：plugin-modules setup 改
  构造值上调用并按变异形式赋端口——交集类型在插件工程声明视图坍缩 never；module.ts 合并
  重复 import；26 文件 prettier patch 经 wt --write＋gzip/base64 回传 git apply；后续又修
  organization-runtime 绑定移入 deps 字面量）④双套件：server 4856 passed | 12 skipped
  (4868)，cli 663 passed (663)，均 @ 4a6829a1d7 ⑤origin 推送随本笔提交后执行。
