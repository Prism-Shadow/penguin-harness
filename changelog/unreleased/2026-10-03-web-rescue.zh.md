# 页面出错时，回退通道仍然可用

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`

[English](2026-10-03-web-rescue.md)

页面渲染时抛错或 module tree 启动失败，不再留下一片空白：Web 应用显示兜底面板，命令面板与 harness 历史仍可使用，因此仍能回退 harness 版本。

- WebApp 的根组件包在 error boundary 内。兜底面板显示错误信息与「重新加载」「不加载贡献重新加载」及 harness 历史入口，中英文均可。`bootWeb()` 失败时挂载同一块面板。
- 命令面板与 harness 历史迁至 `src/rescue/`，挂在 WebApp 的 tree 之外，不再是 `WebAppModule.layers` 的贡献（`PaletteModule` 删除）；在兜底面板上与裸路由下都可用；命令面板为管理员提供的宿主命令（安装 CLI、检查更新、打开 DevTools）同样可用。已挂载的页面用 `usePaletteActions`（`lib/palette-actions.ts`）向面板追加命令，workflow 全页路由的「退出全页模式」即用它。
- 安全模式跳过全部服务端贡献：贡献的页面、公司模式页面、会话 surface 与 quick start 一概不加载。可从兜底面板、命令面板进入，或以 `?safe` 打开应用；在当前标签页内（sessionStorage）跨导航与刷新保持，窗口底部的标记表明其状态，一键即可离开。
- 命令面板默认快捷键改为 ⇧⌘P / Ctrl+Shift+P（原为 ⌥⌘P / Ctrl+Alt+P）；用户自行设置的绑定保持不变。Firefox 会先于页面把该组合用于新建隐私窗口，在 Firefox 中请为命令面板另设组合。对话框打开时该组合仍能打开命令面板，其余快捷键照旧被对话框拦住。
