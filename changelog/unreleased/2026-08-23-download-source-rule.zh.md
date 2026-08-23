# 安装脚本与下载页共用同一套下载源规则

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `tooling`, `landing`, `docs`
- **PR:** [#403](https://github.com/Prism-Shadow/penguin-harness/pull/403), [#406](https://github.com/Prism-Shadow/penguin-harness/pull/406)

[English](2026-08-23-download-source-rule.md)

`install.sh`、`install.ps1` 与桌面端下载页此前各自决定在 GitHub 与 OSS 镜像之间怎么选。现在三者
共用同一套规则，且由实测决定而非预设：对 GitHub 上该 Release 的大测速文件计时，达到 256 KB/s 即
保持 GitHub；只有低于该值时才测量镜像，且仅当镜像快出 1.5 倍以上才切换。GitHub 是免费的源，因此
所有持平与无法测出的比较都留在 GitHub，镜像的带宽也不会花在无法改变结论的探测上。`penguin update`
经由 `install.sh` 继承同一规则。

## 安装脚本

- 自动模式不再把小于 32 MiB 的安装包直接交给镜像而不做任何测量；每一次自动安装都由同一次测量决定。
- GitHub 低于达标线不再等同于选择镜像：镜像同样会被测量，且必须以切换系数胜出才会接管。
- 测速预算涵盖 manifest、连通性探测对以及至多两次吞吐探测，其值取各段上限之和，因此第二次吞吐探测总能拿到完整的窗口。
- 进度输出会写明是两种情形中的哪一种决定了结果。

## 下载页

- 测速期间按钮以加载态等待结论，而不是先指向 GitHub，因此连不上 GitHub 的访客不会拿到一个点了也不会开始的链接。无论测速结论如何，来源仍可手动切换。
- 每个请求都受自身上限与整段 9 秒预算的双重约束；响应头与传输体各有上限，因此始终不响应的源会被判定为不可达，而不必等满传输上限。
- GitHub 不可达时，结论取决于镜像是否响应，用 64 KiB 探测文件询问；GitHub 可达但低于达标线时，则是吞吐问题，用大测速文件测量。
- 结论在浏览器会话内缓存，因此每个标签页至多测量一次。
- 吞吐量读自 Resource Timing 记录而非响应体，因为 GitHub 的 Release 资源拒绝跨源读取。

## 文档

- CLI 安装文档以两种语言说明这套实测选源，以及 `PENGUIN_DOWNLOAD_SPEED_PROBE=0`。
