# Workspace 选择器随被浏览机器的系统适配

- **Date:** 2026-10-02
- **Type:** feature
- **Scope:** `web`, `server`, `docs`

[English](2026-10-02-workspace-finder-per-platform.md)

Workspace 选择器的左栏现在显示被浏览机器自己的文件管理器会显示的内容：带名称的 Windows 盘符、macOS 的各卷、Linux 的根目录与挂载点，以及按该机器自己的规则找到的标准文件夹。从地址栏一次点击即可切换盘符，也可以直接输入 `D:`。

## 细节

- **存储位置。** 常用之后的一节在 Windows 上叫**此电脑**，在 macOS 与 Linux 上叫**位置**。Windows 盘符按资源管理器的写法命名：`Windows (C:)`；卷没有标签时按类型命名（本地磁盘、U 盘、网络驱动器、CD 驱动器），未命名的网络驱动器显示其共享路径（`\\nas\media (Z:)`）。macOS 列出 `/Volumes` 下的各卷，启动盘排第一。Linux 列出**文件系统**（`/`）以及 `/media`、`/run/media`、`/mnt` 下的挂载点；WSL 下 Windows 各盘就在这里，以 `C:` 等命名。
- **地址栏**根部（`C:`、`/`）旁新增下拉箭头，列出同样的各位置；窄屏下左栏收成抽屉时，换盘同样只需一次点击。只输入盘符（`d:`）即打开该盘根目录。
- **标准文件夹**由机器自己给出：Windows 读已知文件夹（被 OneDrive 接管的桌面、文档也能找到），Linux 读 XDG 用户目录（中文桌面的 `~/桌面`、`~/文档`），macOS 用固定名称。经 ssh 浏览的机器仍按英文名查找。
- **刷新与时限。** 每次打开都会重新获取存储位置，期间插上的 U 盘随之出现。查找有时限并短暂缓存：断开的网络驱动器不再拖住弹窗，目录列表也从不等它。
- **Windows 上的隐藏项。** 带隐藏属性的条目像资源管理器一样不再列出：`AppData`、`NTUSER.DAT`、`$Recycle.Bin`，以及 `Application Data` 这类旧式目录链接（以前点进去只会报拒绝访问）。
- **按键。** 非 Mac 上 Ctrl+L、Alt+D 与 F4 进入地址编辑，与资源管理器和 Linux 文件管理器一致；F5 刷新当前目录，不再重新加载整个应用。
- **API。** `GET /api/projects/:p/dirs` 去掉 `roots`；请求主目录并带 `places=1` 时返回 `standardFolders` 与 `locations`，Windows 的列表为隐藏条目标 `hidden`。Server API 文档已写明新字段。
