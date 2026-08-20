# 与桌面应用并行构建的可移植安装镜像

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `desktop`

[English](2026-08-20-desktop-install-image.md)

`pnpm --filter @prismshadow/penguin-desktop build:install-image` 写出
`packages/desktop/install-image/penguin/`，即 `install.sh` 解包的那棵树：`bin/`、`lib/`
（web 资源位于 `lib/web`）以及一份包清单。装有 PenguinHarness 的机器由此可以把自己的
构建交给一台什么都没有的机器。

## 为什么它是独立的一棵树

桌面包自己的产物把外壳与 CLI 一同发布，其启动器在应用自带的 Electron 运行时上跑 CLI。
推送的对端既没有 Electron，也完全没有 PenguinHarness，因此镜像用的是 CLI 包自己的
`pnpm deploy --prod`，落在 `lib/`，启动器跑纯 Node。重新 deploy 只花几秒，避免两种形状
之间靠人手推导。

镜像与 electron-builder 无关：产出它既不运行也不需要一次打包。

## 形状

形状对齐通用发行包——不含内置 `node/`，因此对端需要系统 Node >= 24。启动器仍会在存在
内置运行时时优先使用它，所以日后携带 `node/` 的镜像无需改动即可运行。

若 CLI 入口或 web 资源缺失，构建直接失败，而不是产出一个残缺的镜像。
