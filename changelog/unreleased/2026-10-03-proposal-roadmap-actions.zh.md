# 提案与 roadmap 的写操作成为 Action，部署改由公司模块提供

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `company-proposals`, `company-roadmaps`, `server`, `web`, `cli`
- **Breaking:** yes — 提案与 roadmap 的写路由移到 `…/actions/<key>/runs`，人与员工不再区分，已登记的部署脚本不再运行

[English](2026-10-03-proposal-roadmap-actions.md)

组织的提案与 roadmap 上的每一项写操作都成为一个 Action：有键、作用的对象种类、参数 schema、guard 与执行体。每次运行记为一条 ActionRun，这些运行合起来就是组织的 Activity。公司模块现在可以新增 Action、替换 guard、在运行前后挂钩；部署也成为由这类模块贡献的 Action。

## Action 注册表

- company-proposals 新增第二个模块 `CompanyActionRegistry`。它声明槽 `CompanyActionRegistry.actions`，并在 `/api/projects/:projectId/organizations/:orgId/actions` 下承担全部写操作：
  - `POST /:key/runs` 与 `POST /by-id/:contribution/runs` 接收 `{ subject, params?, requestId?, via? }`，答 `{ run, result }`。运行结束后答 200；运行启动的进程仍在执行时答 202。
  - `GET /[?subject=]` 列出已绑定的 Action，并给出调用者能否对该对象执行每一项。
  - 另新增 `GET /contributions`、`GET /check`、`GET /runs`（按时间、对象、执行者与键分页）与 `GET /runs/:id[?from=]`。
- 对象写作 `organization`、`proposal:<n>`、`comment:<n>/<id>`、`discussion:<n>/<session>`、`roadmap:<n>`、`item:<n>/<key>`、`branch:<remote>/<branch>`、`pr:<owner>/<repo>#<n>` 与 `target:<id>`。
- 对该槽的贡献分四种：
  - `action`：新增一个 Action；
  - `guard`：替换某个 Action 的 guard，并收到缺省 guard 作为基础；
  - `hook`：在 Action 之前或之后执行，键可以以 `.*` 结尾；
  - `subject`：读取对象的状态，对象有提交时一并读取提交。
- 两个插件各自贡献内置 Action：company-proposals 贡献 20 个 Action（`proposal.*` 与 `target.register`），company-roadmaps 贡献 9 个 `roadmap.*` Action。
- 公司模块的贡献要在组织用 `action.bind` Action 绑定之后才生效；绑定存于新表 `action_bindings`。
- 同一个键有两份已绑定的贡献时，只在调用该键时以 409 `action_ambiguous` 拒绝，拒绝中列出每份贡献的精确调用方式。
- 运行的开始行写在它的第一个写事务里，运行与其写入一同提交。被拒绝和失败的尝试同样留下记录。
- 带相同 `requestId` 的重试答第一次的运行。
- `company.db` 中的 `action_runs` 与 `action_run_ends` 只追加。上一个进程留下的未结束运行，在下次打开库时补记为 `abandoned`。
- Action 的参数用 arktype 字符串语法的一个子集声明，在运行之前检查。

## 缺省 guard

- 内置 guard 不再区分人与员工。员工现在可以建提案、批准、评论、request changes 与开讨论。组织内任何人都可以发布修订、改写 brief、标记 ready、请求实现、resolve、结束讨论、起草与确立 roadmap、采纳提案、改名、绑定讨论室与重开。状态规则及其错误码不变。
- 只有作者本人的 ready 需要先回应未关闭的修改请求。
- merged 凭实现者或批准了当前修订者的判断报告，其他人须等 forge 确认已合入。
- 已读位置对人与员工都记录。
- roadmap 条目按组织对 `roadmap.item.approve` 的绑定所列的角色（`config.roles`）批准，缺省为主持人一份、主持人以外任一成员一份。每个主体只批准一次，补齐最后一个角色的那次批准建出提案。
- 仍是 brief 的条目，除其负责人外任何人都可以链接。

## 部署

- 删除 `GET|POST /deploy-scripts`、`DELETE /deploy-scripts/:id`、`penguin org proposal deploy-script add|ls|rm`，不再读取 `deploy-scripts.json`。
- 部署是公司模块贡献的 `deploy.<id>` Action，对象为提案（取其 impl 的 head）、PR 或分支。注册表在运行开始时解析提交；提交不是调用者看到的 `expectedHead` 时，以 409 `head_moved` 拒绝。
- company-proposals 新增 `deploy` 入口 `@prismshadow/penguin-plugin-company-proposals/deploy`，提供 `deployProcess`、`deployGuard`、`DEPLOY_PARAMS` 与 Action 模型的类型。部署保留 `PENGUIN_DEPLOY_*` 环境变量、同时一次的缺省、一小时上限与输出末尾 1 MiB，输出现在随运行一起保存。
- 部署运行结束后，内置的 `deploy.*` after 挂钩刷新 PR 关系图。

## CLI

- `penguin org proposal` 的写子命令保持原有形状，各自执行对应的 Action；`penguin org proposal deploy` 执行 `deploy.<id>` 并跟随输出。
- 新增 `penguin org action ls|run|exec|runs|check|bind`。

## Web

- 提案与 roadmap 的写操作经 Action 路由执行。
- 提案页的按钮按各 Action 对调用者的 guard 显示。
- 提案页新增 Activity 视图，单个提案与 roadmap 旁边也显示自己的运行。
- PR 关系图的节点菜单列出已绑定的 `deploy.*` Action，并跟随运行的输出；删除「关联部署脚本」对话框。
- roadmap 右栏显示每份批准及其角色。

## 兼容性

- 调用旧写路由的客户端（除 `POST /:number/read` 外的 `POST|PUT|PATCH|DELETE …/proposals/…`，以及全部 roadmap 写路由）须改为 `POST …/actions/<key>/runs`。CLI、Web App、roadmap 页面与讨论室会话的命令已随本次改动迁移。
- `deploy-scripts.json` 留在磁盘上，但不再读取。要恢复部署，安装贡献 `deploy.<id>` Action 的公司模块，并在组织中绑定（`penguin org action bind <contribution> --on`）。
- 依赖区分人与员工的限制不再生效。需要恢复这些限制的公司，可以用公司模块替换相应的 guard。
