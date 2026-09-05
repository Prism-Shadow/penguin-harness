# 插件库在首次使用时才寻找宿主包，并且也在启动它的程序上方寻找

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#614](https://github.com/Prism-Shadow/penguin-harness/pull/614)

[English](2026-09-04-plugin-library-host-package.md)

往 Windows 安装热推送被拒绝，报 `No package.json above the plugin loader at …\hmr\store\platform`：平台包在加载时就抛了异常，因为 core 的插件库加载器在 import 时从包自身的路径向上找 package.json，而推送的包放在数据根目录的 store 里，上方没有任何包。加载器现在在第一次调用插件库时才寻找宿主包，绝不在 import 时找；并且找两个地方：像以前一样在自身模块上方，以及在正在运行的程序（`process.argv[1]`）上方——推送的平台所能提供的插件正是装在那里。

## 细节

- `dependencies` 里点名了插件包的第一个 package.json 即为宿主；找不到时取遇到的第一个 package.json，因此源码检出、npm 安装和打包的桌面应用的解析结果与之前完全一致。
- 一台完全没有宿主包的机器现在能加载这个包，随后的插件库调用会失败并列出两处查找位置，而不是让推送失败。
- 插件包通过宿主包自己的 `require` 解析，于是推送的平台读到的是装在程序旁边的插件，而不是去 store 旁边找。
