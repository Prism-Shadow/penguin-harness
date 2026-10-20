# 缺陷报告：模型配置「视觉检测」误报「无法检测接口协议，请检查 API Key 与 base URL」

- 编号：issue-vision-probe-png
- 严重度：P0（功能不可用）／波及 P1（提示误导）／P2（诊断信息丢失）
- 状态：D1、D2 已修复并提交（`28a20cf53`）；D3 已修复（未提交，见 §5.3）
- 复现环境：PenguinHarness 0.2.16（`packages/desktop/out-0.2.16-textures`），tokenrhythm 网关，模型 `deepseek-v4.1-flash-1017`

## 1. 摘要

模型配置弹窗里「支持视觉」旁边的 **「检测」** 按钮永远失败，并弹出「无法检测接口协议，请检查 API Key 与 base URL」。

这句话是**错的**：密钥、base URL、协议全都正常，同一模型的连通性测试返回 `{"ok":true,"latencyMs":911}`。真正的原因在 harness 自己身上——**视觉能力探测用的那张 1×1 PNG 是一张坏图**，任何严格的图片解码器都会拒收它。

一句话：**探测器发出去的图片本身是坏的，于是失败；失败又被翻译成了「你的密钥或 URL 不对」。**

## 2. 影响面

| 影响 | 说明 |
|---|---|
| 功能 | 「视觉检测」按钮对**所有**严格解码器的端点恒定失败，探测功能实际不可用 |
| 误导 | 失败提示指向 API Key / base URL，用户会去改本来正确的东西（甚至重填密钥） |
| 不可判定 | 「模型明确不支持图片」（definitive no）与「探测失败」（learned nothing）被混为一谈，前者本该把开关关掉，后者必须保持原样 |
| 波及 | 同一套 `detectFailedBody` 文案被协议探测与视觉探测共用，两条链路的失败原因完全不同却给同一句提示 |

不受影响的部分：模型的**实际**读图能力正常。`read_file` 读图走的是真实图片文件（字节完整），不经过这张探测图；模型在网关能力目录里也是 `capabilities.vision = true`。所以**被探测按钮拖累的是探测本身，不是模型能力**。

## 3. 触发条件

同时满足即触发：

1. 端点背后的图片解码器是严格的（LiteLLM 及其上的网关，如 tokenrhythm）；
2. 点击模型配置弹窗中「支持视觉」旁的「检测」。

与具体模型、协议、base URL 写法都无关——换任何模型都一样失败。

## 4. 根因

### 4.1 D1（P0，已修）探测用的 1×1 PNG 是一张坏图

`packages/server/src/services/vision-detect.ts` 里的 `VISION_PROBE_IMAGE`：

```
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=
```

逐字节拆开看：

| 检查项 | 结果 |
|---|---|
| PNG 签名 `\x89PNG\r\n\x1a\n` | ✅ |
| IHDR / IDAT / IEND 的 CRC | ✅ 全部正确 |
| IHDR 声明 | 1×1、bit depth 8、**color type 6（RGBA）** |
| IDAT 解压后 | **3 字节**：`01 00 00` = 1 个 filter 字节 + 2 个通道 |
| RGBA 1×1 实际需要 | 1 + 4 = **5 字节** |

**像素数据少了 2 字节。** 宽松的解码器（浏览器、多数 SDK）会容忍，PIL 直接拒绝：

```
PIL open FAILED: OSError: image file is truncated (0 bytes not processed)
```

网关（LiteLLM）也拒绝，并给出：

```json
{"code":"LITELLM_ERROR","message":".messages[0].image[0]: You have uploaded an unsupported image. Please make sure your image is valid and has one of the following formats: webp, png, jpeg, and gif."}
```

**注意：原测试只验了 PNG 签名和 base64 往返，没有验「能不能解码」**，所以这张坏图一路放行。

### 4.2 D2（P1，已修）视觉探测失败复用了协议探测的文案

`packages/web/src/features/models/models-page.tsx` 的 `detectVisionFromButton` 在探测失败时调用 `toastError(S.models.detectFailedBody)`，而 `detectFailedBody` 是**协议探测**专用文案：

> 无法检测接口协议，请检查 API Key 与 base URL。

视觉探测失败的原因是「模型没给出可判断的结果」，跟协议、跟 base URL 都没关系，指错了方向。

### 4.3 D3（P2，未修）provider 的错误原文被 SDK 丢弃

网关的错误 body **不是 OpenAI 形状**：

```json
{"code":"LITELLM_ERROR","message":"...","traceId":"trace_..."}
```

没有顶层 `error` 字段。而 openai SDK v6 的 `APIError.generate` 只取 `body.error`：

```js
// node_modules/openai/core/error.js
const error = errorResponse?.['error'];
if (status === 400) return new BadRequestError(status, error, message, headers);
// ...
static makeMessage(status, error, message) {
  const msg = error?.message ? ... : error ? JSON.stringify(error) : message;
  if (status && msg) return `${status} ${msg}`;
  if (status) return `${status} status code (no body)`;   // ← 我们看到的
}
```

于是 provider 原文丢失，错误消息退化成 `400 status code (no body)`。

连锁后果：`classifyVisionProbe` 靠 `isImageRejection` 匹配错误文本里的 `unsupported image` 才能判定「这个模型明确不支持图片」；文本丢了 → 匹配不到 → 判定从 `unsupported`（明确不支持，应当关掉开关）退化成 `failed`（什么都没学到，必须保持原样）。

**这不是 SDK 的 bug，是适配缺失**：OpenAI 形状的错误会被正确呈现，非 OpenAI 形状的会被丢弃。

## 5. 修复方案

### 5.1 D1：换成一张真能解码的 PNG（已实施）

换成 1×1 RGBA、IDAT 解压后正好 5 字节的图（70 字节，旧图 68 字节）：

```diff
 export const VISION_PROBE_IMAGE =
   "data:image/png;base64," +
-  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
+  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGBgAAAABQABeqhXUAAAAABJRU5ErkJggg==";
```

同时把注释补成「必须能解码，而不只是带 PNG 签名」。

**回归防护**（`packages/server/test/vision-detect.test.ts`）：新增一条断言，逐 chunk 校 CRC、inflate IDAT、比对颜色类型要求的字节数：

```ts
it("is a PNG that DECODES, not one that merely carries the signature", () => {
  // ... 逐 chunk 走 CRC + inflate，断言 inflated.length === 1 + channels[colorType]
});
```

不依赖任何图像库（用 `node:zlib` 的 `crc32` / `inflateSync`），CI 不用装新依赖。

已验证：把常量临时换回旧图，新测试如期失败（`expected 3 to be 5`）；换回新图 10 条全绿。

### 5.2 D2：视觉探测失败有自己的文案（已实施）

新增 `detectVisionFailedBody`（中英各一份）：

- `packages/web/src/lib/strings.ts`：`"视觉能力检测失败：模型没有返回可判断的结果，开关保持原样。"`
- `packages/web/src/lib/strings-en.ts`：`"Vision check failed: the model gave nothing to judge on; the switch is left as it was."`
- `packages/web/src/features/models/models-page.tsx`：`detectVisionFromButton` 的 `else` 分支与 `catch` 分支改用新文案。

协议探测继续用 `detectFailedBody`，两条链路的失败原因不同，提示也不同。

### 5.3 D3：让 provider 的错误原文能到达分类器（已实施）

**目标**：非 OpenAI 形状的错误 body 也要能变成可读的消息，`isImageRejection` 才能正常工作。

**不要走这条路**：靠状态码猜「400 + 带了图 = 不支持图片」。400 同样可能是计费、参数、余额问题，猜错就会把一个能用的模型的视觉开关关掉——而开关被误关正是这套设计明令禁止的（见 `classifyVisionProbe` 的三值契约）。

**已实施（方案 A）**：新增 `packages/server/src/net/error-body.ts`，在 `packages/server/src/index.ts` 的启动序列里紧跟 `installProxy()` 调用 `installErrorBodyNormalizer()`。

- 安装时机：openai SDK 的 `Shims.getDefaultFetch()` 在 **client 构造时**捕获全局 fetch，而 client 由 `GenerativeModel` 每次会话新建，晚于启动期安装。
- 包装规则（四条同时成立才重写）：`status >= 400`、`content-type` 含 json、body 能解析成非数组对象、对象**没有**顶层 `error`。
- **与草案的差异：合并而非替换。** 草案写的是重写成 `{"error":{...}}`；实施时改为 `{...原字段, error:{...}}`，因为 `protocol-detect.ts` 的 `isApiErrorShape` 本来就认这些网关的 `message` / `detail`，替换会把它已经在读的字段抹掉。SDK 只读 `error`，多出来的字段对它无影响。
- 其它细节：用 `response.clone()` 读体、原响应保持未消费；删除 `content-length`（它描述的是被替换掉的旧体）；归一化自身抛错时**原样返回**响应，绝不把 provider 错误变成 harness 错误；用 `Symbol.for` 标记保证重复安装是 no-op（HMR / 内嵌服务重启）。
- 风险点：包住的是全局 fetch，会覆盖进程内所有走全局 fetch 的出站请求。四条规则把影响面限制在「错误 + JSON 对象 + 无 error 字段」；2xx、流式、非 JSON 一律原样放行。注意这里只是**包装**，没有替换 `globalThis.fetch` 的实现——`net/proxy.ts` 刻意不改全局 fetch（SDK 的 Request/FormData 按运行时自己的类做品牌检查），包装器直接透传原参数，这条约束保持不变。

**方案 B（更干净，但要动外部包）**：在 `@prismshadow/mmsp` 的 `OpenaiChatClient` 里支持 `options.fetch` 并透传。已核实 `AutoLLMClient` 的构造参数只有 `model / apiKey / baseUrl / clientType / defaultHeaders`，没有 fetch 口子，所以在 harness 内只能走方案 A。

**验收**：让网关按 §4.3 的形状返回 400，`/models/detect-vision` 的 message 应当变成 provider 原文（而不是 `400 status code (no body)`），并且 `isImageRejection` 能把 `unsupported image` 判成 `unsupported`。

## 6. 复现与验证

### 6.1 复现（当前构建）

```bash
# 本地 harness 的模型配置接口（host 必须是 localhost，127.0.0.1 是 preview host，/api 一律 401）
curl -s -X POST "http://localhost:<port>/api/projects/default_project/models/detect-vision" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"provider":"tokenrhythm","modelId":"deepseek-v4.1-flash-1017"}'
# => {"outcome":"failed","message":"400 status code (no body)"}
```

### 6.2 端到端验证（修复后）

同一个请求应返回 `{"outcome":"supported"}`（模型接了图并作答）。

未修复的构建里，这个请求会稳定返回 400 —— 这就是 §4.1 的复现点。

### 6.3 单元测试

```bash
cd packages/server && ./node_modules/.bin/vitest run test/vision-detect.test.ts
cd packages/server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
cd packages/web    && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

## 7. 验收清单

- [x] D1：`VISION_PROBE_IMAGE` 能被严格解码器接受（PIL `load()` 不报错）
- [x] D1：单测断言「必须真能解码」，把旧常量换回即失败
- [ ] D1：端到端 `/models/detect-vision` 返回 `supported`（**需先重建产物**；网关侧已用等价请求验证：合法 1×1 PNG → 200，模型作答确认看到图）
- [x] D2：视觉探测失败不再弹协议探测的文案（中英文各一条）
- [x] D2：`strings.ts` 与 `strings-en.ts` 键集一致（`tsc --noEmit` 通过）
- [x] D3：非 OpenAI 形状的错误 body 能到达 `isImageRejection`（本地回显 + 真实 openai v6 客户端验证：安装前 `400 status code (no body)`，安装后为 provider 原文且 `isImageRejection` 为 true）
- [x] D3：单测覆盖归一化的四条放行条件、字段保留、`content-length` 删除与重复安装（`packages/server/test/error-body.test.ts`，9 条）
- [ ] D3：在真实网关（tokenrhythm）上跑一次端到端（需要一次计费请求；本地已用同形状的 400 验证）
- [ ] 重建桌面端产物（当前跑的是 `out-0.2.16-textures` 预构建包，源码改动要重新构建才生效）

## 8. 回归风险

| 风险 | 评估 |
|---|---|
| 探测成本 | 新图 70 字节（旧图 68），成本不变；探测本来就是一次真实计费请求 |
| 颜色类型 | 用 RGBA（color type 6），OpenAI / Anthropic / LiteLLM / vLLM 均支持；不要退回 color type 4 以下 |
| 严格解码器之外的端点 | 合法 PNG 对宽松解码器同样合法，无回退风险 |
| 新增测试的依赖 | 只用 `node:zlib`，无新依赖 |
| D2 的文案 | 需同步 `strings-en.ts`，漏了会被 `tsc` 拦下 |
| D3 方案 A | 包全局 fetch 影响面大，必须严格限制在「错误响应 + JSON + 无 error 字段」三条同时成立时才重写 |

## 9. 附：本次排查用到的证据

- 网关能力目录（无需密钥）：`GET https://tokenrhythm.studio/api/models` → `deepseek-v4.1-flash-1017` 的 `capabilities.vision = true`、`responses = true`
- 同一模型同一密钥：纯文本 `POST /v1/chat/completions` → 200；带**旧**探测图 → 400 `LITELLM_ERROR`；带**合法** 1×1 PNG → 200，模型作答里明确说看到了图
- harness 自带连通性测试 `POST /models/test` → `{"ok":true,"latencyMs":911}`（密钥 / base URL / 协议都没问题）
- harness 协议探测 `POST /models/detect` → `{"detected":"openai-responses","baseUrl":"https://tokenrhythm.studio/v1"}`（成功，不是它报的错）
- 用本地回显服务器抓到 harness 实际发出的请求体，确认 `image_url` 里就是那张 68 字节的坏 PNG
- openai SDK v6 最小复现脚本：错误 body 有内容时，SDK 仍报 `400 status code (no body)`（`APIError.generate` 只读 `body.error`）
