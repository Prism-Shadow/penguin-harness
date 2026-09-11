# 内置插件随每个构建发布，推送只传目标缺少的部分

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`, `desktop`, `tooling`
- **PR:** [#383](https://github.com/Prism-Shadow/penguin-harness/pull/383)

[English](2026-09-01-builtin-plugins.md)

本仓库构建出的插件——`plugins/` 下的沙盒后端与语言楼层——现在是每个部署自带的一部分，而不是需要另行获取的包：热推送会带上它们，桌面构建会暂存它们，服务器无需列出即加载。

## 以 npm 包的本来面目发布

`scripts/build-plugins.mjs` 取 `plugins/*` 下每个声明了 `penguin` 的包，先跑包自己的 `build`，再用 `pnpm pack` 打成 tarball——与 `npm publish` 送出的完全一样，`files` 照旧生效——然后用 `npm install` 把这些 tarball 装进一个按 npm 前缀布局的暂存目录：`plugins/package.json` 加 `plugins/node_modules/<name>/…`，每个包的依赖像在任何地方一样由 npm 装在旁边。包的任何部分都不被改写：`package.json`、`exports`、`dist/` 与 `README.md` 都以包自己的构建产出的样子到达目标。SDK 不在装入的依赖之列——插件只对 `@prismshadow/penguin-core` 的类型编译，运行时共用宿主那一份。暂存前缀按所有插件的源码、清单、README 与构建配置的哈希缓存在 `node_modules/.cache/penguin-plugins/` 下，没碰它们的推送不会再构建、打包或安装；只有第一次需要访问 registry 取依赖。

## 落在哪里，怎么加载

热推送把前缀放进资产（`plugins/…`）；桌面构建把它暂存到 `skills/` 旁边（`scripts/build-assets.mjs`、`electron-builder.yml`）。加载器按顺序解析：`<root>/plugins`（数据根自己的前缀）、已提交推送的 `plugins/`（从 `harness.json` 读取，无需宿主）、安装目录的 `plugins/`、安装入口——按 Node 的方式查找包（从基准位置向上找 `node_modules`），读 import 方会读到的入口（`exports` 的 import 条件或 `main`）。插件的说明文档也从同一个包里取：npm 随包发布的那份 `README.md`，按需读取，目录里不存副本。**随构建发布不等于已安装。** `builtin` 只是「这个包从哪来」的标签，绝不是第二种安装方式：构建带来的插件在目录里标为*内置*——安装它不会经过网络——但它的安装、加载与移除与其他插件完全一样，由运维在 `plugins.json` 里列出。因此安装一个内置插件不会执行 npm，只是改一行列表。已安装接口把「随构建发布的集合」与「已安装」分开返回，于是标签可以存在，而不暗示任何人未曾给出的同意。

加载属于 runtime，每个进程一次：带着更新内置插件的推送在下次启动时才生效，与其他插件改动一致。
