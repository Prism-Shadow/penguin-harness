# 浏览器导入为每条跳过的 Cookie 给出原因，并可经扩展读取 Chrome 的 Cookie

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `server`, `web`, `cli`, `browser-extension`, `docs`
- **Issue:** [#1628](https://github.com/Prism-Shadow/penguin-harness/issues/1628)

[English](2026-11-19-browser-import-cookie-reasons.md)

从浏览器导入到内置浏览器时，每条被跳过的 Cookie 都给出原因与数量，原因与提示随读者的界面语言显示。已连接的系统 Chrome 扩展成为读取 Chrome Cookie 的第二条途径，能取到 Windows 上 Chrome 应用绑定加密挡住、磁盘导入读不出的 Cookie，每次导入都要用户在 Chrome 的页面上允许。

## 细节

- 每条跳过的 Cookie 归入一个原因计数：`app_bound`、`dpapi`、`keychain`、`keyring`、`undecryptable`、`partitioned`（只属于某个顶层站点的 Cookie，或 Firefox 容器的 Cookie）或 `expired`，各原因之和等于跳过总数。分区与过期的 Cookie 此前也被跳过，但没有任何说明。
- `POST /api/builtin-browser/import` 改为返回 `cookies.skips`、`notes`（没有 Cookie 库或历史、库被占用或读不出、内置浏览器拒收的 Cookie）与 `browserName`，取代英文的 `warnings` 列表；导入对话框与 `penguin browser import` 用各自的词典成文，CLI 另打印一行 `skipped:`。
- `GET /api/builtin-browser/import/sources` 在调用者的 Chrome 扩展连着时列出 `chrome-extension`（只有 Cookie，来自扩展所在的 Chrome 个人资料），否则以 `extension` 说明原因。导入时向扩展发 `read-cookies`：扩展打开写明服务器的确认页，用户选择「允许」后才调用 `chrome.cookies.getAll`；拒绝、关闭页面或两分钟无应答即答 `import_declined`（403），旧版扩展答 `extension_outdated`（409）。交回的 Cookie 按磁盘导入的规则写入同一 Project 的存储。
- 导入对话框把扩展单列一组；在 Windows 上选中 Chrome 个人资料时，以一行提示说明如何取到只有 Chrome 能读的 Cookie；有应用绑定跳过时，结果中提供「经 Chrome 扩展导入」。
- 扩展新增 `cookies` 权限与主机权限 `*://*/*`。两者都不会在 `debugger` 权限已有的警告之外增加新警告，因此 Chrome 更新扩展时不会再次询问。
