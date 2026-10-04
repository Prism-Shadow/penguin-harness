# 提案与 roadmap 改存每个组织一个 SQLite 文件

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `company-proposals`, `company-roadmaps`, `server`, `web`
- **Breaking:** yes — 新存储从空开始：此前写下的提案、roadmap、已读位置与部署登记都不再读取

[English](2026-10-03-proposals-relational-store.md)

company-proposals 与 company-roadmaps 两个插件不再整份重放只追加的 JSON Lines 账本。每个组织在自己的目录下有一个 SQLite 存储 `company.db`（`node:sqlite`，WAL），两个插件共用，各自只写自己的表。PR 关系图与 PR 状态也落入同一个存储，关系图不再为每一对提交询问 GitHub。路由、响应形状、错误码与 CLI 保持不变，关系图的刷新方式与节点见下文。

## 存储

- 提案的头部、每个修订的全文、事件、评论与 request changes 批次、材料、impl、实现与讨论会话、每个人的已读位置都成为 `proposal_*` 表中的行；roadmap 的头部（含当前的 record 与 body）、条目、委托、批准、讨论室会话、草稿与事件成为 `roadmap*` 表中的行。读取改为带索引的查询，启动时不再折叠任何历史；频道认领以只读连接执行一条查询。
- 修订、提案与 roadmap 的事件、草稿与批准只追加：触发器拒绝对它们的 UPDATE 与 DELETE。存储检查主键、外键、类型与 NOT NULL；各表在启动时以 `IF NOT EXISTS` 建立，没有迁移 runner。
- 每个人的已读位置从 `server_settings` 移入存储。
- 部署登记改存组织目录下专用的只追加文件 `deployments.jsonl`，行形状不变；`deploy-scripts.json` 不变。
- 两个插件的账本模块连同折叠代码一并删除。

## 规则

- 原先写在两个服务里的检查——谁可以做什么、修订号、终态、批准覆盖的修订、一张 PR 与一个 head 只属于一个提案、评论入批次后冻结——成为各插件 `guards.ts` 中的缺省规则，在写事务内调用，错误码不变。区分人与员工的规则原样保留。`ServiceDeps.rules` 可以替换其中任何一条。
- 发布时若修订号已不是下一个（期间另一次发布已落地），答 409 `revision_conflict`。
- `createFromRoadmap` 改为幂等：同一 roadmap 条目、同一 brief 再次调用，返回此前建出的提案。条目的第二次批准、委托与指向提案的链接在一个事务内写入；批准连同它所针对的 brief 的哈希一起保存，只在该 brief 未变时计数。

## PR 关系图与 PR 状态

- 关系图读取按输入键保存的快照，键里含布局它的插件构建（插件加载器给其 import 打的戳，没有时取包版本），因此更新后的第一次读图按新规则重新布局；读图从不执行 git，也不访问网络。刷新先对交付仓库执行一次 `git ls-remote` 探测；只有 ref 有变化时，才经 `gh api graphql` 批量读取 PR、把变化的 ref fetch 到 blobless bare mirror（组织目录下的 `git/<owner>/<repo>.git`），并在其中计算缺少的比较。
- 探测窗口为 5 分钟（新设置 `graphRefreshMinutes`），连续无变化的探测使间隔加倍，最长 30 分钟；无人读图时不做任何探测。登记 impl、页面上的刷新按钮（`GET …/proposals/graph?refresh=1`，等待刷新完成）与部署运行结束会立即刷新。每个组织只有一个刷新器，以存储中的租约保证。关系图最多比仓库晚一个探测窗口，响应新增 `refreshing` 字段。
- 声明的 impl 分支在登记时为每一侧解析一次其 remote 指向的 GitHub 仓库（读提案所在仓库的 `git remote -v`），并与该侧一同保存。关系图、impl 补丁与部署读取保存的仓库，不再重新读取 remotes；remote 之后改指别处时，已登记的 impl 只有在重新登记后才随之改变。
- 未设置交付仓库时，共享工作区的 remotes 由刷新器按探测节奏读取，读图使用它找到的仓库；重启后第一次刷新之前，关系图只有栈底分支，并带 `refreshing`。
- 各部署的服务器改为在每次刷新时探测，不再在每次读图时探测；重启后第一次刷新之前，部署的提交显示为尚未探测。
- impl branch 成为关系图的节点：除开放 PR 外，存活提案已登记、head 在交付仓库上、且没有开放 PR 认领的 impl branch 也画上图，显示提案与阶段；它的 tip 取自探测时 `ls-remote` 读到的值（随其余 ref 一起 fetch 进 mirror），父节点与 PR 一样按祖系判定（登记的 base 若是另一节点的 head，就是那个节点）。分支上开出 PR 后，同一个节点带上 PR 号。节点以 head 分支为键：`ProposalGraphNode` 新增 `key`，`number` 与 `url` 可为 null，`parent`、`off.at`、`top`、`tops`（现总是存在）与部署的 `at` 都指节点的键，`""` 表示栈底分支。关系图页面与 `penguin org proposal graph` 以分支名显示分支节点，并带提案链接、阶段标记与部署菜单（从它部署时经由其提案部署分支的 tip）。未放置原因 `no-pr` 删除：impl branch 只在 `unread`（head 不在交付仓库上或读不到）与 `merged` 时列在图下。快照的输入键包含各 impl 的 base 分支与 head 的 tip。
- 登记的 base 就是栈底分支的节点——以 `main` 为 base 登记的每个 impl branch，以及 base 声明为栈底、实际叠在别的节点上的开放 PR——以其余节点中 head 是它的祖先、且相隔提交最少的那一个为父节点，没有这样的节点才挂在栈底分支上；登记的 base 是另一节点的 head 时仍由它决定。刷新在 mirror 中对各 head 超出栈底 tip 的提交做一次遍历（`git rev-list --parents … --not <base>`），在内存中算出祖系，与其余事实一同存入新表 `graph_lineage`，并计入快照的输入键，读图仍不执行 git。祖系尚未读到的 head 在下一次刷新前为 `unread`。
- 直接挂在栈底分支上的每条线各成一栈、留在链上：一张从栈底分出、到此为止的单个 PR，不再因为旁边有继续往下走的栈而判为 `not-taken`。分叉处取继续往下走的那一支（其余判 `not-taken`）只用于栈内部的分叉。页面与 `penguin org proposal graph` 在栈底上标出栈数；「底座上分叉」标记已删除。
- 关系图改按 Sapling smartlog 的样子画：最新的在上，主干占第一列，从某个节点分出的一串画在它右边一列、紧挨在该节点之上，以 `├─╯` 接回（同一节点上的几串依次画出，不再散成扇形），栈底分支画成最下面一行 `~`，带自第一个栈的底层建成以来栈底前进的提交数。服务端只排一次版（关系图响应中的 `rows`，每格两个字符的制表符）；`penguin org proposal graph` 按行输出、后接各节点的信息，画不出的节点另列；页面以等宽格子在每行旁画出同样的格子，路线图标题与折叠段照旧。页面自己的泳道布局已删除。
- 关系图缺省只画本组织自己的部分：带本组织提案的节点，以及其下这些线所需的、不带提案的 PR（例如 impl 叠在其上的上游 PR），后者淡显。响应在 `rows` 之外新增 `ownRows`，行新增 `connector`；链仍对全部 open PR 判定。页面上的「显示其他 PR」开关（按浏览器记住）与 `penguin org proposal graph --all` 画出全部；CLI 第一行注明未画出的 PR 数。
- 在关系图页按 Ctrl+F（macOS 为 ⌘F）在图顶部打开搜索框，取代浏览器的页内查找，作为可改绑的新快捷键 `graph.search`；搜索框已获焦时再按一次交还浏览器自己的查找。可匹配 PR 号（`#213`）、提案号（`proposal 194`、`p194`）、分支名与 PR、提案标题，含被隐藏的节点；Enter／Shift+Enter 在结果间跳转（「3/12」），目标行滚入视野并高亮，所在的折叠段展开，缺省视图不画它时临时画出全图。Esc 关闭搜索。
- 插件停止（部署、热更新）时若有关系图刷新在进行，会在关闭存储之前释放该刷新持有的租约，不再让它在过期之前挡住强制刷新。
- PR 状态在存储中缓存 5 分钟，在后台以一次批量读取刷新；读提案不再等待 `gh`。报告 `merged` 仍立即询问 forge，并回写结果。

## 删除组织

- 删除组织时先把它标记为删除中：直到目录移走之前，宿主路由、插件路由与调度器都把它当作不存在（404）。
- 新增槽 `OrganizationModule.retirements`，供插件在目录移动之前释放它为该组织持有的资源；每份贡献最多等待 30 秒，超时或抛错会被记录，不阻止删除。company-proposals 贡献的一份中止该组织的 PR 关系图刷新（连同其 `git` 与 `gh` 子进程）、PR 状态批量读取与正在运行的部署脚本（按被终止的运行记录），并关闭它的 `company.db` 连接；company-roadmaps 贡献的一份等待该组织进行中的写入与转发，然后关闭连接。其他组织不受影响，已删组织的库不会被重新打开；之后以同一 id 新建的组织从空库开始。
- 组织正在运行的会话——桌面、工单会话、讨论室与讨论，以及它们的后台命令（例如一次 Claude Code 运行）——在目录移动之前被中止，不等待其结束。
- 目录移动失败时（例如 Windows 上仍有文件被打开），答 409 `organization_busy`，消息带操作系统给出的原因与路径，不再答 500，组织保持原状。

## 兼容性

此前写下的内容一概不读：`proposals.jsonl` 与 `roadmaps.jsonl`（以及[此前兼容性条目](2026-10-03-backward-compatibility-impl-branch.zh.md)为它们描述的旧形态）、`server_settings` 中的 `company-proposals:reads:*` 键，以及 `proposals.jsonl` 中的 `deployment` 行。组织的提案、roadmap、已读位置与部署登记从空开始。旧文件原样留在磁盘上，不做导入。部署需要用 `penguin org proposal deployment add` 重新登记。
