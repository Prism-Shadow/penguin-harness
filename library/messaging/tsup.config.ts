import { defineConfig } from "tsup";

export default defineConfig({
  // The chat-markdown parser is inlined into the bundle rather than left a bare
  // "@prismshadow/penguin-ui/chat-markdown" import: the entry documents that the server side
  // inlines it, and a bare import here would reach the runtime loader as a workspace package
  // whose package.json exports point at TypeScript sources, which Node refuses to load from
  // node_modules. remark-parse and the micromark extensions stay external — they are this
  // package's own dependencies.
  noExternal: [/@prismshadow\/penguin-ui/],
  entry: [
    "src/index.ts",
    "src/messaging.ts",
    "src/repos/index.ts",
    "src/repos/messaging-bindings.ts",
    "src/repos/messaging-conversations.ts",
    "src/account-holders.ts",
    "src/account-routes.ts",
    "src/bridge.ts",
    "src/channel-specs.ts",
    "src/connector.ts",
    "src/enabled-channel.ts",
    "src/error-kind.ts",
    "src/feishu-card.ts",
    "src/feishu-connector.ts",
    "src/feishu-sdk.ts",
    "src/markdown.ts",
    "src/mask.ts",
    "src/media.ts",
    "src/ports.ts",
    "src/qq-api.ts",
    "src/qq-connector.ts",
    "src/qq-markdown.ts",
    "src/qq-scan.ts",
    "src/recall.ts",
    "src/reply-files.ts",
    "src/routes.ts",
    "src/scan-flow.ts",
    "src/scan-routes.ts",
    "src/task-attachments.ts",
    "src/telegram-api.ts",
    "src/telegram-connector.ts",
    "src/telegram-html.ts",
    "src/vocabulary.ts",
    "src/wechat-api.ts",
    "src/wechat-connector.ts",
    "src/wechat-markdown.ts",
    "src/wechat-scan.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
