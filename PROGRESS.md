# G3 restack S20–S22 — 进度与分支头

- 组分支：restack3/S20-S22（base origin/main ae7390398f）
- 工作树：/home/kamiyoru/work/ts/restack3-g3
- 验证通道：vps compile / vps wt / vps test（2026-11-24 owner 变更后）

## 当前分支头（owner 轮询取这里）

S20 提交后更新：见下方时间线。

## 时间线

- 2026-11-24：S20 代码落地（主体提交 7ac1affb12：organization 9 文件 + runtime 11 文件 +
  organization-deletion + routes 工厂 → library/organization；契约 DTO → library/organization/types
  与 library/agent/types；SEMANTIC_ID_PATTERN → core；server 侧 shim + module.ts 装配 +
  OrgRoutes 绑定端口；org-harness 补 semanticId 端口）。changelog 双语已加。
- 待办：lockfile 重生成（走 vps compile 通道，frozen-lockfile 若拒则报 owner 集中处理）；
  compile + 三件套 + 双套件；S21；S22。
