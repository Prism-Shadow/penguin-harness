---
title: "PenguinHarness 0.2.1：桌面端应用来了"
date: 2026-08-04
category: news
excerpt: 0.2.1 把完整的 Web 体验装进一个双击即用的桌面应用——macOS / Windows / Linux 三平台安装包、打开即已登录、与 CLI 安装共用同一份数据；配套上线软件下载页，安装包同步镜像到阿里云 OSS；独立安装脚本与 penguin update 学会自选下载源；压缩失败不再拖垮会话、烧掉的重试成本终于可见；管理员初始密码随机化并加登录限流。逐项看看。
---

PenguinHarness 0.2.1 发布了。主角是桌面端：不打开终端、不看登录页，双击图标就是完整的 PenguinHarness。围绕它，分发管道与下载体验也一并升级。逐项说明：

## 桌面端应用

一个刻意做薄的 Electron 壳：它把现有服务端作为子进程拉起，窗口指向 `http://localhost`——没有私有 IPC、没有 preload、没有 node integration，一切能力仍然走同一套 HTTP API。打开即已登录：一次性 token 落地管理员会话，没有登录页，也没有要抄写的初始密码。

数据与 CLI 安装**完全共用** `~/.penguin/data`：桌面端与 `penguin web` 可以混用，同一数据目录同一时刻只运行一个服务端（新增的 `server.lock` 单实例锁，CLI 与壳都遵守）——CLI 已启动实例时，应用直接接入它。UI 偏好（语言、主题）在重启后保持：壳会记住上次绑定的端口并在仍空闲时复用，窗口 origin 稳定，浏览器按 origin 存放的偏好随之稳定。

安装包覆盖 macOS（dmg，Apple 芯片 / Intel）、Windows（NSIS）与 Linux（AppImage / deb）。当前构建暂未签名：macOS 首次启动右键 →「打开」，Windows 在 SmartScreen 中选「更多信息 → 仍要运行」。

## 下载页，以及镜像到 OSS 的桌面安装包

[penguin.ooo/download](https://penguin.ooo/download) 是一张经典的软件下载页：每个平台一张卡片、检测到的系统打上标记、点击即下载。按钮默认指向 GitHub 的 `releases/latest/download` 静态直链——安装包改为无版本号命名，这类链接才成为可能——页面同时在后台解析 OSS 镜像的 `latest.json`，解析成功即切到镜像的不可变版本目录，并显示当前版本号，可手动切换来源。桌面安装包与 CLI 包一样逐字节镜像到阿里云 OSS。

## 安装脚本与 penguin update 自选下载源

从 Release 页保存的 `install.sh` / `install.ps1` 现在与 penguin.ooo 转发层同口径：`PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`，`auto` 优先 OSS、同版本回退 GitHub；新发布的安装脚本内嵌自己的 Release tag，保存多久都下载与之匹配的版本，不再悄悄跟随未来的 latest。`penguin update` 采用同一契约：升级不再从 GitHub 起步，版本发现优先走 OSS 的 `latest.json`，强制模式严格生效，失败信息本地化。

## 压缩失败不再拖垮会话

某些模型会把 `[summary]` 写成标题、正文放在闭合标签之后——旧逻辑取到空摘要，每次重试还把模型自己的错误输出回显给它，会话就此陷入失败循环。0.2.1 的摘要提取带容错阶梯，不可用的响应按标准重试预算与退避阶梯重来并附纠正提示；烧掉的尝试次数与 token 终于计入统计与成本中心，重试详情（`error_message` / `attempt` / `retry_in_ms`）在 CLI 与 Web 上直接可见。

## 登录加固

固定的初始密码 `penguin-2026` 退役：首次启动生成随机密码、只打印一次；登录端点按用户名做指数限流（5 次免罚，1 秒起倍增至 60 秒），4 位数字空间不再可枚举。

## Web 应用改进

技能可以在界面里管理了：Agent 设置新增 Skills 标签页，列出磁盘上已装技能，支持卸载、zip 导入导出与对话驱动安装；新的 `skill-porting` 库技能把外部生态的技能规范化迁入。Project 设置新增「新对话默认值」——默认 Agent、工作目录、审批模式、思考等级与模型，落进每个新草稿。Traces 页与会话侧栏共享同一套分组组件，会话分页、轨迹索引落到 SQLite，不再逐请求扫文件系统。对话页：大纲刻度轨按 ±20 轮开窗不再压住输入区，成本统计跨任务边界不再闪没，上传的文件附件按用户内容渲染（右对齐、随图片同款时间戳，插话 chip 里也能看到），工具输出的 ANSI 颜色码被彻底拦下。

## 其余改进

服务端最后两个 IO 热点关闭：调度器每 30 秒的 tick 与 schedules 路由改为 mtime 门控缓存，`GET /messages` 支持游标分页与 Web 端尾部优先加载。`hono` 升级越过 CORS 预检 ReDoS 通告；OpenRouter 目录新增 `qwen/qwen3.8-max`。完整清单逐条见 [changelog/0.2.1](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.1)。

## 安装或升级

桌面端：前往 [penguin.ooo/download](https://penguin.ooo/download) 下载对应平台安装包。

CLI / 服务端：

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows（PowerShell）：`irm https://penguin.ooo/install.ps1 | iex`；或在 Node >= 24 下 `npm install -g @prismshadow/penguin-cli`。已有安装直接 `penguin update`——这一版起，它也走镜像了。
