# 超出模型像素上限的工具产物图片在工具处被拒绝，而不是让 Session 永远 400

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`
- **Issue:** [#944](https://github.com/Prism-Shadow/penguin-harness/issues/944)

[English](2026-10-10-tool-image-dimension-cap.md)

用 `read_file` 读一张极长或极宽的图片——整页截图、长图表——可能把一张端点直接拒绝的图片交给模型。各 provider 对图片最长边有硬上限（DeepSeek 的线画在 8192 px，超线一律 400，且报错措辞伪称"格式不支持"），而图片本身是完全合法的文件；更糟的是 fatal 的工具结果会随之后每次请求原样重放，于是 Session 在同一 input 索引上每轮都以同样方式失败——Session 内没有任何东西能丢掉这张附件，compaction 也跑不起来。现在 `read_file` 会读图片头，拒绝附加超过上限的图片，并用自己的话说明原因。

## 细节

- `read_file` 的图片分支仅从文件头解析像素尺寸（PNG IHDR、JPEG SOF 帧头、GIF 逻辑屏幕描述、WebP VP8/VP8L/VP8X——都在文件前几十字节内，零新依赖，不解码像素），长边超过模型上限时以尺寸和真实原因失败：`Image too large for this model: 750×8618 px exceeds the 8192 px longest-side limit, so it is not attached. […] Downscale the image first (e.g. with a shell command) and read the smaller copy.`。守卫同时覆盖本地与 URL 两个来源，并在纯文本会话调用视觉模型之前生效。头部解析不出的字节（扩展名兜底可能把无头部内容当图片放行）不拒绝——没有拒绝的依据。
- 上限跟随模型：Project 的模型条目可用 `max_image_side`（px，长边）自行指定；内置 catalog 行可携带 `maxImageSide`（"恢复默认"时随行写入 Project 条目）；两者都缺省时取保守默认 8192 px（`MAX_IMAGE_SIDE`）。该值作为按上下文注入的服务（`EnvironmentServices.maxImageSide`）到达工具，模型切换时与视觉描述器答案一同重解析。
- 字节上限（5 MB）与其余全部校验保持不变；两个上限之内的图片附加行为与从前完全一致。已携带超限附件的 Transcript 仍需一条恢复路径（丢弃或缩小那一张附件）——那是另一个改动。
