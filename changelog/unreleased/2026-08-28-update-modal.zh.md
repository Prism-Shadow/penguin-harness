# 更新集中到一个弹窗：确认、看着下载、重启

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `web`, `server`, `desktop`, `cli`, `docs`
- **Breaking:** yes — `POST /api/version/update` 改为立即返回任务状态，不再阻塞到整个更新结束

[English](2026-08-28-update-modal.md)

两个更新入口——新对话页版本行上的「有新版本可用」上标，以及侧边栏用户菜单里「系统设置」下方
的那一行——现在打开同一个更新弹窗，弹窗按应用更新器的方式走完更新：先检查，查到的版本连同更新
说明与「下载并更新」按钮一起给出（按下之前不下载任何东西），下载中显示进度条并可「放到后台」，
就绪后「重启并更新」。此前：上标直接跳 GitHub 页面；服务端的弹窗把整个安装塞进一个漫长的请求、
没有进度，最后只说「请手动重启服务」；桌面应用里「检查更新」一点就自行开始下载。

## 细节

- Web：`lib/update-flow.ts` 是唯一的状态机（`unknown` / `checking` / `disabled` /
  `up-to-date` / `available` / `downloading` / `ready` / `restarting` / `error` /
  `unsupported`），覆盖服务端版本与桌面 shell 更新器两个后端；`lib/use-update-flow.ts` 负责动作、
  轮询与弹窗关闭时的结果提示。弹窗（`components/account/update-modal.tsx`）与行
  （`update-row.tsx`）取代了原来的更新弹窗、服务端行、桌面行与安装确认框。关闭弹窗从不取消任何
  事：那一行继续显示百分比，就绪后头像出现圆点并弹出提示。版本行上标随状态变化（「有新版本可用」/
  「正在下载更新」/「重启以更新」）并打开弹窗。
- Server：在线更新改为后台任务（`services/update-job.ts`）——`POST /api/version/update` 启动
  （或并入）任务，`GET` 报告 `phase`，以及安装器 `curl --progress-bar` 运行期间真实的 `percent`；
  结束后的结果保留到下一次启动，再次启动即重试。新增 `POST /api/version/restart`：有托管进程时
  （`PENGUIN_SUPERVISED=1`，作为 `lifecycle` 运行时能力发布给 platform）在优雅关闭后以 core 的
  `SERVER_RESTART_EXIT_CODE`（75）退出，否则应答 `no_supervisor`。桌面中继新增
  `POST /api/desktop/update/download` 与快照状态 `available`。
- CLI：`penguin server` 与 `penguin web` 把服务作为子进程运行并托管它——转发终端信号、以其退出码
  退出、在重启退出码上重新拉起，使重新拉起的进程运行刚安装的新版本（打印「正在重启服务以应用更
  新…」）。经 `tsx` 的开发运行无法被普通 node 重新拉起，仍在本进程内运行。
- Desktop：shell 不再自行下载。检查以新增的 `available` 状态结束；下载由页面的 `download` 指令
  或原生对话框开始——菜单发起的检查现在以「Download / Later」对话框收尾——原生的「立即重启」提示只
  跟在原生对话框发起的下载之后。下载失败时切换备用源重试的逻辑不变。
- 文档：Web App、CLI 与 Server API 页面描述了弹窗、托管进程与任务 / 重启接口。

## 兼容性

- `POST /api/version/update` 原先把请求挂到整个更新结束并应答 `{status, output, needsRestart}`；
  现在立即应答任务状态（`{state, targetVersion, phase?, percent?, output, result?, …}`），旧结构
  保留在 `result` 里；等待结果改用 `GET /api/version/update`。Web App 与服务端一起发布，用户无需
  做任何事；调用旧接口的脚本应改为轮询 GET。
- `DesktopUpdaterCommandMessage.action` 与 `DesktopUpdateStatus.state` 变宽（新增 `download`、
  `available`）。shell 与服务端在同一个安装包里发布。
- SDK 接口未动，磁盘上的数据没有任何变化。
