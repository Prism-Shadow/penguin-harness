# 按钮取用它所挨着的那一档，菜单搜索框有了自己的记录

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`
- **PR:** [#699](https://github.com/Prism-Shadow/penguin-harness/pull/699)

[English](2026-09-11-control-unification.md)

沿 [#689](https://github.com/Prism-Shadow/penguin-harness/pull/689) 立下的规矩对表单控件做的第二遍：
尺寸只有一份记录，规则靠检查而不是靠记住。

## 详情

- 设置对话框里有四个按钮比它们旁边的字段高一档——账户的「修改密码」、代理与上传的「保存」、管理
  员用户页的「新建」。这四个都是对话框**正文**里的按钮，#689 的规则本就把它们归在 `sm`；它们保留
  了 `Button` 的 `md` 缺省，只因为没有任何检查看得见它们。`control-size.test.ts` 现在把设置对话框
  的各页列进 `DIALOG_BODY_MODULES`，其中不写 `sm` 的 Button 会让它失败。
- 智能体页头部加了搜索框——按名称、id 与描述过滤，不分大小写——形状与模型库头部一致：同样的
  `flex-wrap` 标题行、同样的 `min-w-0 flex-1 sm:w-56 sm:flex-none` 包裹、同样的 `Input size="sm"`。
  创建按钮由 `md` 降为 `sm`，与旁边的搜索框读起来同档。搜不到时说的是「没有匹配」，而不是「没有
  Agent」。
- 模型库的「同步预置」只在确有待同步时出现，并以重点色呈现。无可同步时点它是空操作，而常驻的按钮
  为此占掉了头部的宽度。那颗更新圆点随之撤掉：它的意义是标出模型 trail 终点的那个按钮，而按钮现在
  只在 trail 存在时才存在，那颗点等于每次被看见时都亮着。
- 四个不走 `Input` 的原生 `<input>` 搜索框——模型选择器、Skill 选择器、Workspace 浏览器、机器选择
  器——改为读取 `components/ui/input.tsx` 的 `menuSearchClass` 或 `panelSearchClass`，不再各写一份。
  这四份副本此前在圆角、内距、聚焦色、边框是否有过渡上已经各不相同。内距仍留给调用方，那是唯一真正
  该有差异的地方。
- 机器页的安装动作是全应用最后一个仍为 `md` 的页面头部按钮，而它旁边就是机器选择器。`CreateButtons`
  的 `size` 缺省是 `md`，但两个调用点都显式传了 `sm`，这个缺省已经不可达——对下一个调用者是个陷阱；
  现在缺省为 `sm`。
- 文件选择器必须用 `<label>`，三处各自把 Button 的样子手拼了一遍（其中两份逐字节相同），现在改为取用
  `button.tsx` 的 `labelButtonClass(variant, size)`，它由 `Button` 自己读的那两份记录拼出。
- `.agents/skills/penguin-harness-frontend/SKILL.md` 把按钮规则记为「按钮取用它所挨着的那一档」，并
  列出三处该取 `sm` 的场合。
