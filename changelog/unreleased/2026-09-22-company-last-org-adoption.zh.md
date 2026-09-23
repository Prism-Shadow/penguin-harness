# 公司侧栏显示的是当前页面所在的组织

- **Date:** 2026-09-22
- **Type:** fix
- **Scope:** `web`
- **PR:** [#824](https://github.com/Prism-Shadow/penguin-harness/pull/824)

[English](2026-09-22-company-last-org-adoption.md)

公司模式下打开某个组织的页面时，侧栏（工位、频道）可能停留在**上一次**打开的组织上：页面写着一家
公司，侧栏列的却是另一家的员工，切换组织时看起来像新组织没有任何 Session。

## Details

- 没有路由指明组织时，shell 会采用上次打开的组织（存在偏好设置里）。这个判断用的是发起它的那次
  渲染里的值；而组织路由在自己的 effect 里设置当前组织，同一次提交里它先执行，shell 看到的仍是
  「没有」，于是用存储的组织盖掉了路由指定的组织。
- 现在这个判断是 store 的方法 `adoptLastOrg`，按当下的 store 状态决定：路由的选择优先，只在没有任何
  组织被指定时才采用存储的那个。
