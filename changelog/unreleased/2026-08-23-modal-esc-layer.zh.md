# 对话框内菜单按 Escape 只关菜单，不再关掉整个对话框

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `web`

[English](2026-08-23-modal-esc-layer.md)

`Modal` 改为通过 latest-callback ref 读取 `onClose`，其注册的 Escape 层只在对话框打开时入栈一次，不再每次渲染重新入栈。各调用点的 `onClose` 都是内联箭头函数，重新入栈会把对话框自身的层压回其内部已打开菜单之上，此时按 Escape 关闭的是整个对话框——已填写的内容随之丢弃——而不是只关掉那个菜单。
