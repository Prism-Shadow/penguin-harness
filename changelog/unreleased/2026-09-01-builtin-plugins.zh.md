# 内置插件随每个构建发布，推送只传目标缺少的部分

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`, `desktop`, `tooling`

[English](2026-09-01-builtin-plugins.md)

本仓库构建出的插件——`plugins/` 下的沙盒后端与语言楼层——现在是每个部署自带的一部分，而不是需要另行获取的包：热推送会带上它们，桌面构建会暂存它们，服务器无需列出即加载。

## 按内容打包一次

`scripts/build-plugins.mjs` 把每个 `plugins/*` 自包含地 bundle（esbuild，依赖内联；只有 SDK 的纯类型表面保持外部）成 npm 前缀的形态——`plugins/package.json` 加 `plugins/node_modules/<name>/{index.js,package.json,README.md}`——这是所有消费者统一解析的布局。产物按插件源码、清单和 README 的哈希缓存在 `node_modules/.cache/penguin-plugins/` 下，一次没碰它们的推送不会重新打包。无法 bundle 的插件会被报告并排除，绝不带着问题发出去。

## 落在哪里，怎么加载

热推送把前缀放进资产（`plugins/…`）；桌面构建把它暂存到 `skills/` 旁边（`scripts/build-assets.mjs`、`electron-builder.yml`）。加载器按顺序解析：`<root>/plugins`（插件页装的）、已提交推送的 `plugins/`（从 `harness.json` 读取，无需宿主）、安装目录的 `plugins/`、安装入口。**随构建发布不等于已安装。** `builtin` 只是「这个包从哪来」的标签，绝不是第二种安装方式：构建带来的插件在目录里标为*内置*——安装它不会经过网络——但它的安装、加载与移除与其他插件完全一样，由运维在 `plugins.json` 里列出。因此安装一个内置插件不会执行 npm，只是改一行列表。已安装接口把「随构建发布的集合」与「已安装」分开返回，于是标签可以存在，而不暗示任何人未曾给出的同意。

加载属于 runtime，每个进程一次：带着更新内置插件的推送在下次启动时才生效，与其他插件改动一致。

## 推送只传目标缺少的部分

目标上的资产现在按内容寻址：`store/blobs/<sha256>` 每份不同内容只存一次，物化出的资产目录由这些 blob 组装而成并记录所用（`.manifest.json`）。推送前 `scripts/deploy.mjs` 用 `POST /api/hmr/assets/probe { hashes }` 询问目标缺哪些 blob，只发这些，其余以哈希指名（`assets.manifest` + `assets.blobs`）。清单指名了存储里没有的 blob 会被拒绝并给出说明，绝不物化成一个洞。没有探测端点的目标——比这更老的 runtime——回应 404，于是收到全部内联文件，和它一直以来收到的推送完全一样。因此未变的原生模块、技能库和插件不会重复过线。

## 清理未使用的资产

存储原本就只保留当前与一个回滚的资产集合；现在在此之后还会清扫 blob：任何剩余集合都未记录的 blob 会被删除，半写的临时文件也一并清除。记录出现之前物化的集合不通过 blob 存储维持任何东西的存活，其自身也不受影响。
