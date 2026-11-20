# 应用中心默认显示每个工作台，除非它声明不显示

- **Date:** 2026-11-19
- **Type:** feat
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1655](https://github.com/Prism-Shadow/penguin-harness/pull/1655)

[English](2026-11-19-app-center-show-default.md)

工作台现在都会在应用中心有图块，除非它的 `package.json` 把 `penguin.appCenter.show` 设为 `false`。没有声明 `appCenter`，或 `appCenter` 里没有 `show` 的工作台都会显示，因此 Agent 漏写这个键的应用也有图块。

## 细节

- **已有的工作台。** 此前写成、从未声明 `penguin.appCenter` 的工作台，升级后会出现在应用中心。与以前一样，工作台行上的**展示到应用中心**开关可以把它关掉，即写入 `show: false`。
- **工作台行的开关。** `WorkbenchInfo.appCenter` 报告生效的值，因此没有声明的工作台，开关显示为开。
- **不变的部分。** 声明不合规的工作台（例如 `show` 不是布尔值）仍然没有图块，加载提示仍会写明怎么修。已停用的工作台没有图块。
- **应用中心为空时。** 页面上的说明不再要求先打开这个开关。
