# 在插件页安装插件不再让标签页卡死

- **Date:** 2026-11-20
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1668](https://github.com/Prism-Shadow/penguin-harness/pull/1668)

[English](2026-11-20-plugin-install-stream-freeze.md)

在插件页点击服务端模块的「安装」会让浏览器标签页卡死：服务端立即发出第一条进度事件，Web App 读取这份答复的代码随即陷入死循环，标签页失去响应，而安装本身在服务端照常完成。现在读取代码逐条取出答复中的事件，按钮显示安装进度，结束时的提示说明结果。

## 细节

- 自 [#1457](https://github.com/Prism-Shadow/penguin-harness/pull/1457) 起，插件页上以流读取服务端答复的每一次安装都受影响，与插件无关；把插件安装到 Agent 不受影响。
- 卡死后刷新页面会看到插件已安装，因为服务端已经装好了它。
