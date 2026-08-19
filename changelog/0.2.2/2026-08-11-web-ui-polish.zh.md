# Web App：可关闭的密码横幅、/model 提示、Agent 列表与标签顺序打磨

- **Date:** 2026-08-11
- **Type:** fix
- **Scope:** `web`
- **PR:** [#252](https://github.com/Prism-Shadow/penguin-harness/pull/252), [#253](https://github.com/Prism-Shadow/penguin-harness/pull/253), [#254](https://github.com/Prism-Shadow/penguin-harness/pull/254), [#255](https://github.com/Prism-Shadow/penguin-harness/pull/255), [#259](https://github.com/Prism-Shadow/penguin-harness/pull/259)

[English](2026-08-11-web-ui-polish.md)

一轮审查带出的五处界面修复（[#252](https://github.com/Prism-Shadow/penguin-harness/pull/252)、[#253](https://github.com/Prism-Shadow/penguin-harness/pull/253)、[#254](https://github.com/Prism-Shadow/penguin-harness/pull/254)、[#255](https://github.com/Prism-Shadow/penguin-harness/pull/255)、[#259](https://github.com/Prism-Shadow/penguin-harness/pull/259)）：

- **可关闭的初始密码横幅（[#254](https://github.com/Prism-Shadow/penguin-harness/pull/254)）。** 那条催促用户改掉预置密码的顶部横幅在右缘新增一个关闭叉——一个不带背景填充的扁平字形，只在悬停时加深，配色与「立即修改」链接一致。关闭是逐用户永久生效的：它存放在服务端的 `ui_prefs` 中（`initialPasswordBannerDismissed`），因此跨设备、跨浏览器都成立。该横幅只在偏好完成水合之后才渲染——已关闭的横幅绝不会闪一下——而当偏好请求出错时则安全地回退为显示。
- **锁定模型芯片的提示与光标（[#252](https://github.com/Prism-Shadow/penguin-harness/pull/252)）。** 会话锁定模型之后，点击那个只读模型芯片现在只提示「输入 /model 切换模型」，而不再是那段关于新会话延续的冗长括注；芯片的悬停光标也从问号形的 `cursor-help` 改为 `cursor-pointer`——它是一个可点击的按钮，而这也是整个代码库中唯一一处 `cursor-help`。
- **Agent 列表的设置按钮（[#253](https://github.com/Prism-Shadow/penguin-harness/pull/253)）。** 逐 Agent 的设置按钮此前渲染的是一条手写的齿轮路径，它已经与侧边栏那个规范的 lucide 齿轮产生漂移，在 13px 下显得糊，而且图标颜色比它自己的标签还暗一档。规范的齿轮现在住在共享图标模块中，侧边栏从那里导入，而该按钮的图标像它旁边的「新建对话」一样继承标签颜色。
- **开关控件重做样式（[#259](https://github.com/Prism-Shadow/penguin-harness/pull/259)）。** 共享的滑动开关在鼠标点击后不再残留灰色光晕——聚焦环改到 `focus-visible` 并带强调色调——并获得了像样的边缘：轨道上一条内嵌细线，关闭态的灰色为真正中性的深色调色板重新调过（旧的偏冷 `gray-600` 显脏），旋钮上一条细线使它在接近纯白的中性强调主题下仍能显形，以及带缓动的过渡。旋钮的细线画作它自己 16px 盒内的一条边框（此前是叠在轨道细线之上的一圈外环，在近弧处合成一条更粗的线，读起来像是间距不均），它那道偏移投影已去掉，而几何尺寸全部为整数像素、旋钮与轨道端帽同心——在两种状态下、四周对轮廓都是均匀的 1px 间隙，并已在两种主题下用 1x 与 2x 的放大截图逐一核实。组件 API 与开关语义未变；五处使用点全部验证过。
- **Agent 详情的标签顺序与统计行（[#255](https://github.com/Prism-Shadow/penguin-harness/pull/255)）。** 详情标签定于规范顺序：Overview、System Prompt、Runtime、Tools、Skills、Memory、Vault、Schedules（Memory 从第三位移出；中文标签「Prompt」改为「系统提示词」，英文为 "System Prompt"），而 Agent 列表中可点击的统计图标在会话数与更新时间之间镜像同一顺序。该统计行还去掉了逐项的 `min-w` 预留——较短的计数不再留下参差的空洞——并把统一的 flex 间距从 `gap-x-2.5` 加宽到 `gap-x-4`，使该行保有呼吸空间。
