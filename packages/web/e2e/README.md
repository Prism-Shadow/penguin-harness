# Web E2E（Playwright）

浏览器端到端：对话（thinking + 工具审批 + 工具执行 + 二轮答复）、图标化统计（成本折算 /
复制回复）、轨迹观测（分 Task 时间线 + 图例 + 悬停联动高亮）、Workspace 文件预览（HTML
sandbox 渲染、路径默认隐藏）。LLM 由 `mock-llm.mjs`（mock Anthropic Messages SSE）驱动，
不联网。

```sh
pnpm --filter @prismshadow/penguin-web test:e2e          # 构建 + 起服务 + 跑用例
SKIP_BUILD=1 pnpm --filter @prismshadow/penguin-web test:e2e   # 跳过构建
```

首次需 `npx playwright install chromium`。
