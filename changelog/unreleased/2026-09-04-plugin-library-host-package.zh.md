# 插件库在首次使用时从两个固定起点确定宿主包

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `core`
- **PR:** [#614](https://github.com/Prism-Shadow/penguin-harness/pull/614)

[English](2026-09-04-plugin-library-host-package.md)

往 Windows 安装热推送被拒绝，报 `No package.json above the plugin loader at …\hmr\store\platform`：平台包在加载时就抛了异常，因为 core 的插件库加载器在 import 时从包自身的路径向上找 package.json，而推送的包放在数据根目录的 store 里，上方没有任何包。宿主包——`dependencies` 里点名插件包的那份 package.json——现在在第一次调用插件库时确定，绝不在 import 时确定，起点是两个固定位置：加载器自身所在的安装，以及运行中的程序（`process.argv[1]`）所在的安装——推送的平台所能提供的插件正是装在那里。

## 细节

- 每个起点各自向上，走到第一份 `dependencies` 点名插件包的 package.json；先试加载器自身所在的安装。途中不点名插件包、或读不出来、无法解析的 package.json 都会被跨过去，不拿它当答案。
- 不再退回「第一份读得出来的 package.json」：两个起点都找不到宿主时，插件库调用失败，错误列出实际试过的两个起点，而不是让推送失败、或让插件库悄悄变空。
- 程序路径先解析符号链接，于是包管理器的 bin 会指回它所属的那份安装。
- 插件包通过宿主包自己的 `require` 解析，于是推送的平台读到的是随程序安装的插件，而不是去 store 旁边找。
