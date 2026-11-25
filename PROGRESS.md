# restack3/W10-W13 — G4（web 片搬进 library 包）

基 origin/main f2efa42ccb（基线前进后重排：W10→W11→W12→W13）。

## 机制（每片同形）
- library/<域>/src/web/<feature>；face index（具名导出＋空 default）；package.json exports ./web、./web/*
- tsconfig.json exclude src/web；tsconfig.web.json（extends packages/web/tsconfig.json，供包内自查）
- 被搬文件经 @prismshadow/penguin-web/internal 消费宿主；npm 运行时依赖（react 等）进库包声明
- packages/web：tsconfig paths + vite/vitest alias 解析 face 与 internal（库包不进 web 的依赖表——injectWorkspacePackages 会把带工作区回环的依赖注入成 dist-only 副本，靠不声明依赖＋显式解析绕开）
- packages/web/src/internal.ts：宿主共享件与留守 feature 的再导出枢纽
- 测试守卫：helpers/roots.ts 增 library:<域> 扫描根；module-boundaries 基线随边消失删行

## 分支头
- W10 agents → library/agent：0105e42d80
- W11 projects → library/project：6a38ddcf51
- W12 traces → library/trace：42547b90a6
- W13 models+model-picker → library/model：本提交
