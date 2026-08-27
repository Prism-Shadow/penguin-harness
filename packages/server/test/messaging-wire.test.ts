/**
 * Protocol tests for the two messaging adapters, at the boundary each one actually calls:
 * the Lark SDK's HTTP instance, and `fetch`.
 *
 * These exist because the suites next door could not have caught the two bugs that reached
 * a user. Those suites substitute a hand-written implementation of *our own* seam
 * (FeishuSdk, TelegramTransport), which proves the bridge drives the seam correctly and
 * proves nothing whatever about whether the adapter behind it speaks the real protocol —
 * every wire detail is stubbed out along with the wire. Both shipped bugs lived in that
 * gap: an image download whose refusal reason was silently discarded, and an upload path no
 * test had ever run against a real response shape.
 *
 * So the fake here is pushed down one layer, to the transport itself:
 *
 * - **Feishu**: `createLarkSdk({ httpInstance })` hands the real SDK a stand-in for axios,
 *   so the SDK's own URL building, `:path` filling, param serialization, payload formatting
 *   and response unwrapping all run for real. The stub must reproduce what the SDK's own
 *   response interceptor does to an axios response — return `resp.data` (the parsed body),
 *   or `{data, headers}` when the call asked for `$return_headers` — because that is the
 *   contract the SDK's generated methods are written against. Errors are thrown in axios's
 *   shape, `{response: {status, data}}`, and for a `responseType: "stream"` request the
 *   error body is a stream too, which is the whole of bug 1.
 * - **Telegram**: the Bot API is plain HTTPS, so the stub is `globalThis.fetch`, and the
 *   assertions are on the URLs, the multipart field names and the error text.
 *
 * No test opens a socket.
 */
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createLarkSdk } from "../src/runtime/messaging/feishu-sdk.js";
import { createTelegramTransport } from "../src/runtime/messaging/telegram-api.js";
import { MessagingMediaTooLargeError } from "../src/runtime/messaging/media.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
const CREDS = { appId: "cli_wire", appSecret: "secret", baseDomain: "https://open.feishu.cn" };

/** One request as the stub saw it, before the SDK's response handling. */
interface WireCall {
  method?: string;
  url?: string;
  params?: unknown;
  data?: unknown;
  contentType?: unknown;
}

/** What a stubbed route answers with: a parsed body, a stream, or an axios-shaped throw. */
type Answer =
  | { body: unknown }
  | { stream: Buffer; headers?: Record<string, string> }
  | { status: number; streamError: unknown };

/**
 * A stand-in for the axios instance the Lark SDK talks to, reproducing its response
 * interceptor (see the file header). `routes` answers by URL.
 */
function larkHttp(routes: (url: string) => Answer): {
  http: unknown;
  calls: WireCall[];
} {
  const calls: WireCall[] = [];
  const answer = (url: string, config?: Record<string, unknown>): unknown => {
    const found = routes(url);
    if ("body" in found) return found.body;
    if ("stream" in found) {
      const data = Readable.from([found.stream]);
      // $return_headers is what the download asks for; the interceptor pairs body + headers.
      return config?.$return_headers === true
        ? { data, headers: found.headers ?? {} }
        : (data as unknown);
    }
    const err = new Error(`Request failed with status code ${found.status}`) as Error & {
      response?: unknown;
    };
    err.response = { status: found.status, data: found.streamError };
    throw err;
  };
  return {
    calls,
    http: {
      // The SDK's TokenManager posts the token endpoint through the same instance.
      post: (url: string) => {
        calls.push({ method: "post", url });
        return Promise.resolve(answer(url));
      },
      request: (config: Record<string, unknown>) => {
        const headers = config.headers as Record<string, unknown> | undefined;
        calls.push({
          method: config.method as string,
          url: config.url as string,
          params: config.params,
          data: config.data,
          contentType: headers?.["Content-Type"],
        });
        return Promise.resolve(answer(config.url as string, config));
      },
    },
  };
}

/** The tenant-token exchange every Lark call makes first. */
const TOKEN_ANSWER: Answer = {
  body: { code: 0, msg: "ok", tenant_access_token: "t-abc", expire: 7200 },
};

describe("feishu adapter against the SDK's HTTP boundary", () => {
  it("downloads a message image from the resource endpoint and reads the type off the bytes", async () => {
    const { http, calls } = larkHttp((url) =>
      url.includes("tenant_access_token")
        ? TOKEN_ANSWER
        : // The header lies about the type on purpose: the bytes decide.
          { stream: PNG, headers: { "content-type": "application/octet-stream" } },
    );
    const client = await createLarkSdk({ httpInstance: http }).createClient(CREDS);
    const out = await client.fetchMessageImage({
      messageId: "om_wire_1",
      fileKey: "img_v2_wire",
      maxBytes: 20 * 1024 * 1024,
    });
    expect(out.data.equals(PNG)).toBe(true);
    expect(out.mimeType).toBe("image/png");
    // The message id and the image key ride in the PATH, and the resource type in a query
    // param — the shape no seam-level fake can check.
    const call = calls.at(-1)!;
    expect(call.method).toBe("GET");
    expect(call.url).toBe(
      "https://open.feishu.cn/open-apis/im/v1/messages/om_wire_1/resources/img_v2_wire",
    );
    expect(call.params).toEqual({ type: "image" });
  });

  it("reports the API's own refusal reason, which arrives as a STREAM (the shipped bug)", async () => {
    // A Feishu app that receives messages happily is still refused here until the resource
    // read scope is granted. Because the request asks for a stream, the ERROR body is a
    // stream too — reading `err.response.data.msg` finds nothing and leaves only "Request
    // failed with status code 403", which is what made the first bug report unactionable.
    const denial = {
      code: 99991672,
      msg: "Access denied. app has no permission to access resource",
    };
    const { http } = larkHttp((url) =>
      url.includes("tenant_access_token")
        ? TOKEN_ANSWER
        : { status: 403, streamError: Readable.from([Buffer.from(JSON.stringify(denial))]) },
    );
    const client = await createLarkSdk({ httpInstance: http }).createClient(CREDS);
    await expect(
      client.fetchMessageImage({ messageId: "om_x", fileKey: "img_x", maxBytes: 1024 * 1024 }),
    ).rejects.toThrow("Access denied. app has no permission to access resource (code 99991672)");
  });

  it("falls back to the generic text when the error body is not a Feishu envelope", async () => {
    const { http } = larkHttp((url) =>
      url.includes("tenant_access_token")
        ? TOKEN_ANSWER
        : { status: 502, streamError: Readable.from([Buffer.from("<html>bad gateway</html>")]) },
    );
    const client = await createLarkSdk({ httpInstance: http }).createClient(CREDS);
    await expect(
      client.fetchMessageImage({ messageId: "om_x", fileKey: "img_x", maxBytes: 1024 }),
    ).rejects.toThrow("Request failed with status code 502");
  });

  it("refuses a download past the cap as a size error, not as a failure", async () => {
    const { http } = larkHttp((url) =>
      url.includes("tenant_access_token") ? TOKEN_ANSWER : { stream: Buffer.alloc(4096) },
    );
    const client = await createLarkSdk({ httpInstance: http }).createClient(CREDS);
    await expect(
      client.fetchMessageImage({ messageId: "om_x", fileKey: "img_x", maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(MessagingMediaTooLargeError);
  });

  it("uploads a picture, then sends the returned key as an image message", async () => {
    // The upload endpoints resolve to their INNER `data` object rather than the `{code,msg}`
    // envelope the JSON endpoints return — a difference invisible to a seam-level fake, and
    // the reason this path had never actually been run against a real response shape.
    const { http, calls } = larkHttp((url) => {
      if (url.includes("tenant_access_token")) return TOKEN_ANSWER;
      if (url.endsWith("/im/v1/images")) {
        return { body: { code: 0, msg: "success", data: { image_key: "img_v2_up" } } };
      }
      if (url.endsWith("/im/v1/messages")) return { body: { code: 0, msg: "success", data: {} } };
      throw new Error(`unstubbed ${url}`);
    });
    const client = await createLarkSdk({ httpInstance: http }).createClient(CREDS);
    await client.sendImage("oc_wire", { fileName: "chart.png", data: PNG });
    const upload = calls.find((c) => String(c.url).endsWith("/im/v1/images"))!;
    expect(upload.contentType).toBe("multipart/form-data");
    expect(upload.data).toMatchObject({ image_type: "message" });
    expect((upload.data as { image: Buffer }).image.equals(PNG)).toBe(true);
    const sent = calls.find((c) => String(c.url).endsWith("/im/v1/messages"))!;
    expect(sent.data).toEqual({
      receive_id: "oc_wire",
      content: JSON.stringify({ image_key: "img_v2_up" }),
      msg_type: "image",
    });
  });

  it("uploads other files under the category the client previews them by", async () => {
    const { http, calls } = larkHttp((url) => {
      if (url.includes("tenant_access_token")) return TOKEN_ANSWER;
      if (url.endsWith("/im/v1/files")) {
        return { body: { code: 0, msg: "success", data: { file_key: "file_v2_up" } } };
      }
      return { body: { code: 0, msg: "success", data: {} } };
    });
    const client = await createLarkSdk({ httpInstance: http }).createClient(CREDS);
    await client.sendFile("oc_wire", { fileName: "report.pdf", data: Buffer.from("%PDF-") });
    await client.sendFile("oc_wire", { fileName: "notes.md", data: Buffer.from("hi") });
    const uploads = calls.filter((c) => String(c.url).endsWith("/im/v1/files"));
    // A known category renders a preview in the client; everything else is a plain stream.
    expect(uploads.map((c) => (c.data as { file_type: string }).file_type)).toEqual([
      "pdf",
      "stream",
    ]);
    expect((uploads[1]!.data as { file_name: string }).file_name).toBe("notes.md");
    const sent = calls.filter((c) => String(c.url).endsWith("/im/v1/messages"));
    expect(sent[0]!.data).toMatchObject({
      msg_type: "file",
      content: JSON.stringify({ file_key: "file_v2_up" }),
    });
  });

  it("names the file when an upload comes back without a key", async () => {
    // A refused upload resolves to a `data`-less body, so the failure is a MISSING key
    // rather than a thrown error — the adapter has to notice that itself.
    const { http } = larkHttp((url) =>
      url.includes("tenant_access_token")
        ? TOKEN_ANSWER
        : { body: { code: 234020, msg: "image size exceeded" } },
    );
    const client = await createLarkSdk({ httpInstance: http }).createClient(CREDS);
    await expect(client.sendImage("oc_wire", { fileName: "chart.png", data: PNG })).rejects.toThrow(
      /chart\.png returned no image_key/,
    );
  });
});

describe("telegram adapter against the fetch boundary", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const TOKEN = "7000000001:SECRET-TOKEN-VALUE";
  const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22]);

  /** Records every request and answers by URL. */
  function stubFetch(answer: (url: string) => Response | Promise<Response>): {
    urls: string[];
    bodies: unknown[];
  } {
    const urls: string[] = [];
    const bodies: unknown[] = [];
    globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
      urls.push(String(url));
      bodies.push(init?.body);
      return Promise.resolve(answer(String(url)));
    }) as typeof globalThis.fetch;
    return { urls, bodies };
  }

  const okJson = (result: unknown): Response =>
    new Response(JSON.stringify({ ok: true, result }), {
      headers: { "content-type": "application/json" },
    });

  it("downloads a photo in two hops: getFile, then the FILE endpoint", async () => {
    const { urls } = stubFetch((url) =>
      url.includes("/getFile")
        ? okJson({ file_path: "photos/file_7.jpg", file_size: PHOTO.length })
        : new Response(PHOTO, { headers: { "content-type": "image/jpeg" } }),
    );
    const bot = createTelegramTransport().createClient({ botToken: TOKEN });
    const got = await bot.getFileBytes({ fileId: "full-1280", maxBytes: 20 * 1024 * 1024 });
    expect(got.data.equals(PHOTO)).toBe(true);
    expect(got.filePath).toBe("photos/file_7.jpg");
    // The second hop is /file/bot<token>/<path> — a different endpoint from the methods,
    // and the detail most easily got wrong.
    expect(urls[0]).toBe(`https://api.telegram.org/bot${TOKEN}/getFile`);
    expect(urls[1]).toBe(`https://api.telegram.org/file/bot${TOKEN}/photos/file_7.jpg`);
  });

  it("never puts the bot token in an error, though the download URL embeds it", async () => {
    // Transport failure first.
    stubFetch(() => {
      throw Object.assign(new Error("fetch failed"), { cause: new Error("ECONNREFUSED") });
    });
    const bot = createTelegramTransport().createClient({ botToken: TOKEN });
    await expect(bot.getFileBytes({ fileId: "f", maxBytes: 1024 })).rejects.toThrow(
      /getFile failed/,
    );
    await expect(bot.getFileBytes({ fileId: "f", maxBytes: 1024 })).rejects.not.toThrow(
      /SECRET-TOKEN-VALUE/,
    );
    // Then an HTTP failure on the file endpoint itself, whose URL carries the token.
    stubFetch((url) =>
      url.includes("/getFile")
        ? okJson({ file_path: "photos/f.jpg" })
        : new Response("nope", { status: 404 }),
    );
    const err = await bot
      .getFileBytes({ fileId: "f", maxBytes: 1024 })
      .then(() => null)
      .catch((e: Error) => e);
    expect(err?.message).toBe("file download failed: HTTP 404");
    expect(err?.message).not.toContain("SECRET");
  });

  it("refuses a file the API already says is over the cap, as a size error", async () => {
    stubFetch(() => okJson({ file_path: "photos/f.jpg", file_size: 30 * 1024 * 1024 }));
    const bot = createTelegramTransport().createClient({ botToken: TOKEN });
    await expect(
      bot.getFileBytes({ fileId: "f", maxBytes: 20 * 1024 * 1024 }),
    ).rejects.toBeInstanceOf(MessagingMediaTooLargeError);
  });

  it("posts a picture as multipart sendPhoto, and other files as sendDocument", async () => {
    const { urls, bodies } = stubFetch(() => okJson({}));
    const bot = createTelegramTransport().createClient({ botToken: TOKEN });
    await bot.sendPhoto({ chatId: "42424242", fileName: "chart.png", data: PHOTO });
    await bot.sendDocument({
      chatId: "-1002233445566",
      fileName: "notes.md",
      data: Buffer.from("hi"),
    });

    expect(urls[0]!.endsWith("/sendPhoto")).toBe(true);
    expect(urls[1]!.endsWith("/sendDocument")).toBe(true);
    const photo = bodies[0] as FormData;
    // The field name is the API's, not ours, and the file must arrive with its name on it.
    expect(photo.get("chat_id")).toBe("42424242");
    const file = photo.get("photo") as File;
    expect(file.name).toBe("chart.png");
    expect(file.size).toBe(PHOTO.length);
    const doc = bodies[1] as FormData;
    expect(doc.get("chat_id")).toBe("-1002233445566");
    expect((doc.get("document") as File).name).toBe("notes.md");
  });

  it("surfaces a Bot API refusal of an upload with its description", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ ok: false, description: "PHOTO_INVALID_DIMENSIONS", error_code: 400 }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const bot = createTelegramTransport().createClient({ botToken: TOKEN });
    await expect(
      bot.sendPhoto({ chatId: "1", fileName: "chart.png", data: PHOTO }),
    ).rejects.toThrow("sendPhoto failed: PHOTO_INVALID_DIMENSIONS (code 400)");
  });
});
