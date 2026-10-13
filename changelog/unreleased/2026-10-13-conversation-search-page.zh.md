# 会话搜索页，以及直达命中消息的链接

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `web`

[English](2026-10-13-conversation-search-page.md)

服务端已经能凭「里面说过什么」找到一段对话（见 `2026-10-13-conversation-search.md`），但 Web App 里没有任何地方去问它。这里补上那个页面。

## 为什么是一个页面，而不是侧栏里的一个框

要回答「那句话是在哪段对话里」，需要一个过滤栏——哪个智能体、哪个工作区、哪个月、是否含已归档——以及一行宽到能读下摘要的结果。侧栏两样都给不了，于是每个命中都得先点开才能判断。本页通过与侧栏同一个端点、同一个页大小、同一份纯逻辑（`lib/session-search.ts`），经同一个 hook（`lib/use-conversation-search.ts`）取数；新增的是宽度、过滤器和深链。

## 页面

- **`/search`** 是一个独立页面，因此搜索可以被链接、刷新也能保留：查询存在 URL 里（`?q=`），过滤器是页面状态——它们是阅读这份答案的一种方式，而不是一个自己的位置。
- 每条结果行带上会话标题、智能体、工作区与最后活跃时间、匹配消息数，以及最多三段带高亮标记的摘要。仅标题命中的行会明说，而不是显示一段空摘要。
- 索引仍在建立时页面会说明（来自状态路由的 `index`），因此第一次搜索读起来是「仍在索引」而不是「没有找到」。
- 命中项的摘要就是链接：点行打开该对话，点读者认出来的那一行则带着该时刻打开（`lib/message-jump.ts`，`/chat/<id>?at=…`）。

## 细节

- 新增：`features/search/search-page.tsx`、`lib/session-search.ts`（过滤器、时间范围、摘要与标记切分、搜索路径）、`lib/use-conversation-search.ts`（共享的查询/分页 hook）、`lib/message-jump.ts`。
- `api/endpoints.ts` 新增 `searchSessions`；`module.json` 注册该页面，`router.tsx` 映射它；`strings.ts` / `strings-en.ts` 新增 `search` 命名空间。
- 控件与 Web App 其余部分一样取自 `@prismshadow/penguin-ui`。
