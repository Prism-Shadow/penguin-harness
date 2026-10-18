# Web App：页面按路由按需加载，入口 chunk 减半

- **Date:** 2026-10-18
- **Type:** refactor
- **Scope:** `web`

[English](2026-10-18-web-route-lazy.md)

应用里的每个页面此前都是路由的静态 import，于是入口 chunk 在登录页能画出来之前就装下了全部二十个
页面——终端运行时、跑分器、模型表都在里面。现在每个页面各自站在一个动态 import 后面，入口 chunk 从
3,238,173 字节降到 1,710,888 字节。

## 细节

| | 改前 | 改后 |
| --- | --- | --- |
| 入口 chunk（`dist/assets/index-*.js`） | 3,238,173 B | 1,710,888 B（−47.2%） |
| 入口 chunk，gzip | 988.57 KB | 537.38 KB |
| `/login` 首屏 | 3,238,173 B | 1,716,589 B |
| `/chat` 首屏 | 3,238,173 B | 2,676,648 B |
| 页面 chunk | 0 | 20 |
| `dist/assets/*.js` | 121 个文件，11.17 MB | 183 个文件，11.20 MB |

- `router.tsx` 新增 `lazyPage(load, name)` 助手，把想要的导出名一并传进去，于是 Vite 产出的 chunk、
  调用栈和 Network 面板都能说清是哪个页面，而不是一坨匿名 chunk。二十个模块移到它后面：登录页、
  终端、workbench 应用页、七个公司页，以及 `module.json` 声明的九个页面。
- 新增 chunk 里最大的两个是 chat 页（338 KB）与 markdown/KaTeX 的 prose 包（497 KB）；
  `/chat` 是唯一首屏仍在兆字节量级的路由，因为它两个都要。
- `DRAFT_SESSION_ID` 搬到 `features/chat/draft-session-id.ts`，`chat-page.tsx` 继续 re-export，
  既有导入路径照旧可用。侧边栏、应用外壳、agents 页、插件页与 AI 桥都读它——就一个字符串——而
  ESM 的静态导入是整模块的，于是应用外壳为了拿到它把整个聊天界面（会话流、流式控制器、markdown、
  工作区浏览器）拖了进来。
- 路由处与更上层都没有新增 `React.Suspense` 边界。
