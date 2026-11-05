---
title: "PenguinHarness 0.2.1：桌面应用与下载页"
date: 2026-08-04
category: news
excerpt: 0.2.1 为 macOS、Windows 和 Linux 带来桌面应用，打开即已登录，数据与 CLI 共享。同时上线由 OSS 镜像提供安装包的下载页，安装和更新可以选择下载源，登录也做了加固。
---

PenguinHarness 0.2.1 发布了，主角是桌面应用：不用终端，没有登录页，双击图标就能打开完整的 PenguinHarness。分发体验也一并改进：新的下载页从阿里云 OSS 镜像提供安装包，安装脚本和 `penguin update` 可以选择下载源。此外，压缩失败不再卡死会话，首次启动的管理员密码也改为随机生成。

## 桌面应用

桌面应用是一个刻意做薄的 Electron 壳。它以子进程启动现有的服务端，并把窗口指向 `http://localhost`。没有私有 IPC，没有 preload 脚本，也没有 Node 集成，一切仍走同一套 HTTP API。应用通过一次性 token 直接以管理员身份登录，因此没有登录页，也不用抄写初始密码。

数据与 CLI 安装完全共用，都放在 `~/.penguin/data` 下，桌面应用和 `penguin web` 可以混着用。一个数据根目录同一时刻只运行一个服务端，这由新增的 `server.lock` 单实例锁保证，CLI 和应用都遵守它。如果 CLI 启动的服务端已经在运行，应用会直接接入。

语言、主题等界面偏好在重启后依然保留。应用会记住服务端上次使用的端口，只要端口仍然空闲就继续沿用。这样窗口的 origin 保持不变，保存偏好的浏览器存储也随之稳定。

提供以下平台的安装包：

- macOS：dmg，支持 Apple 芯片和 Intel
- Windows：NSIS
- Linux：AppImage 和 deb

0.2.1 的构建尚未签名。在 macOS 上首次启动时，右键点击应用并选择「打开」。在 Windows 上，遇到 SmartScreen 提示时选「更多信息 → 仍要运行」。

## 下载页，以及镜像到 OSS 的桌面安装包

0.2.1 新增了 [penguin.ooo/download](https://penguin.ooo/download)，这是一个经典的软件下载页：每个平台一张卡片，自动识别并标出你的系统，点一下即可下载。

安装包的文件名不再带版本号，所以页面上的按钮可以先指向 GitHub 的静态 `releases/latest/download` 链接。页面刚上线时，会在后台读取 OSS 镜像的 `latest.json`，读取成功后，按钮切换到镜像上这个版本的固定目录，页面显示解析出的版本号，并提供开关让你手动切换下载源。桌面安装包和 CLI 包一样，逐字节镜像到阿里云 OSS。

## 安装脚本和 penguin update 自选下载源

从 Release 页面保存的 `install.sh` 或 `install.ps1`，现在遵循与 penguin.ooo 安装脚本相同的策略：`PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`，`auto` 优先使用 OSS，并回退到 GitHub 上的同一版本。新发布的安装脚本还会内嵌自己的 Release tag，无论保存多久，下载的都是与之匹配的版本，不会悄悄跟着后来的新版本走。

`penguin update` 遵循同样的规则。升级时不再先访问 GitHub：查询最新版本时优先读取 OSS 的 `latest.json`，`oss` 和 `github` 两种模式绝不回退，失败信息也会用你的语言显示。

## 压缩失败不再卡死会话

有些模型把 `[summary]` 写成标题，正文却放在闭合标签之后。旧逻辑会取到空摘要，而且每次重试都把模型自己写坏的输出再给它看一遍，它就照抄下去，会话由此卡在失败循环里。

0.2.1 的摘要提取能容忍这类不规范的格式。响应仍然不可用时，按标准的重试预算和退避重试，并给模型附上一条纠正说明。重试消耗的尝试次数和 Token 现在会计入统计和**成本中心**，重试详情（`error_message` / `attempt` / `retry_in_ms`）在 CLI 和 Web App 里都能看到。

## 登录加固

固定的初始密码 `penguin-2026` 退役了。首次启动时会生成随机密码，格式是 `penguin-` 加四位数字，并且只打印一次。登录接口还会按用户名限制失败尝试：失败 5 次后，每次尝试都要等待，延迟从 1 秒起步，逐次翻倍，最长 60 秒。想靠穷举四位数字来猜密码，就不现实了。

## Web App 改进

### 在应用里管理 Skill

**Agent 设置**新增**技能**标签页，列出磁盘上已安装的 Skill，支持卸载、zip 导入导出，以及通过对话安装。技能库新增的 `skill-porting` 可以把其他生态的 Skill 引入进来并规范化。

### 新对话默认值

**Project 设置**新增**新对话默认值**：每个新对话草稿默认使用的 Agent、工作目录、审批模式、思考等级和模型。

### 更快的轨迹观测页

**轨迹观测**页复用侧栏的分组组件，会话改在服务端分页，并通过 SQLite 索引查找 Trace 文件，不再每次请求都遍历文件系统。

### 对话页

- 对话索引的刻度条只显示当前位置前后各 20 轮，也不再与输入框重叠。
- 成本统计不再在 Task 之间消失。
- 上传的文件附件显示为你消息的一部分，靠右对齐，时间戳样式与图片一致，插话标签里也能看到。
- ANSI 颜色代码不再混进工具输出。

## 其余改进

- 服务端最后两个磁盘 IO 热点已经消除。每 30 秒一次的调度器 tick 和 schedules 路由改为读取缓存，缓存只在文件变化时刷新；`GET /messages` 支持游标分页，Web App 加载对话时因此先取最新的消息。
- `hono` 升级到不受 CORS 预检 ReDoS 安全通告影响的版本。
- OpenRouter 模型目录新增 `qwen/qwen3.8-max`。

完整清单逐条见 [changelog/0.2.1](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.1)。

## 安装或升级

桌面应用：到 [penguin.ooo/download](https://penguin.ooo/download) 下载对应平台的安装包。

CLI / 服务端：

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows 上请在 PowerShell 中运行 `irm https://penguin.ooo/install.ps1 | iex`。Node >= 24 的环境也可以用 `npm install -g @prismshadow/penguin-cli` 安装。在 Linux 和 macOS 上升级已有安装，运行 `penguin update` 即可，它现在同样通过镜像下载。
