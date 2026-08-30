# 热推的 bundle 通过加载它的安装找到技能库

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `skills`

[English](2026-08-30-pushed-skills-root.md)

技能库原先按"读它的模块所在目录的上一级"定位——即包自身的 `skills/`,桌面应用里也是 `<app>/dist` 旁边的 `<app>/skills`。热推的 bundle 运行在 `<root>/hmr/store/<kind>/` 里,旁边没有库,于是查找指向一个永远不存在的 `store/skills`;推送版本在**全新**数据根上首次启动时,第一次扫描技能就崩溃(`ENOENT … store/skills`),而默认 Project 早已存在的根则毫无察觉。Machines 页面的每一次远程安装都是这样的全新根。

## 细节

- 库根目录现在在首次使用时解析一次,取以下第一个存在的:`PENGUIN_SKILLS_DIR`;包自身的 `../skills`;以及相对进程入口(`process.argv[1]`)的安装自带副本——已安装程序为 `<program>/lib/node_modules/@prismshadow/penguin-skills/skills`,桌面应用为 `<app>/skills`。都不存在时沿用包布局。
- `resolveSkillsRoot` 导出并对每种布局做了单元测试。
