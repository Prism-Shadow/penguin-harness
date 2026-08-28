/**
 * The WeChat production adapter — the half of the channel that talks to Tencent.
 *
 * messaging-wechat.test.ts drives the connector and its routes over a fake transport, which
 * leaves everything under that seam unexercised: the request envelope and its headers, the
 * long poll's cursor, the reduction of the wire's message shape to the connector's event, and
 * the whole CDN media path — a pre-signed upload of AES-128-ECB ciphertext in one direction
 * and a decrypt in the other. Those are where a platform failure actually reaches this
 * product, so they get their own file (the split messaging-qq-transport.test.ts makes).
 *
 * Nothing here opens a socket. `globalThis.fetch` is stubbed the way that suite stubs it —
 * a test hook rather than a module mock, because this suite shares one module registry
 * across files and `vi.mock` would leak into every later one (see vitest.config.ts).
 */
import { describe, expect, it } from "vitest";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { MessagingMediaTooLargeError } from "../src/runtime/messaging/media.js";
import type { WeChatCredentials } from "../src/runtime/messaging/wechat-api.js";
import {
  WECHAT_API_BASE,
  WECHAT_VIDEO_FILE_NAME,
  WeChatApiError,
  createWeChatTransport,
  normalizeWeChatMessage,
  parseWeChatAesKey,
} from "../src/runtime/messaging/wechat-api.js";

const CREDS: WeChatCredentials = {
  botId: "bot_9001",
  botToken: "wx-bot-token-ABCD-1234",
  baseUrl: WECHAT_API_BASE,
  userId: "ilink_user_aaa",
};

const USER = "ilink_user_aaa";

/** One recorded request against the stubbed fetch. */
interface Call {
  url: string;
  method: string;
  body: string;
  headers: Headers;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Installs a fetch stub for the run of `body`, and hands it the calls it recorded.
 *
 * `answer` returns the response for one call; returning null means "the default", which is
 * an empty success — enough for the calls a test makes on its way to the one it is about.
 */
async function withFetch<T>(
  answer: (call: Call, index: number) => Response | null,
  body: (calls: Call[]) => Promise<T>,
): Promise<T> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      headers: new Headers(init?.headers),
    };
    // The CDN upload sends bytes rather than a string; recorded separately below.
    if (init?.body instanceof Uint8Array) uploads.push(Buffer.from(init.body));
    calls.push(call);
    const answered = answer(call, calls.length - 1);
    if (answered !== null) return answered;
    return jsonResponse({ ret: 0 });
  }) as typeof fetch;
  try {
    return await body(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** Bytes POSTed to a CDN upload URL during the current `withFetch`. */
let uploads: Buffer[] = [];

const defaults = (): null => null;

/** The abort signal a poll takes; every test that is not about cancellation passes a live one. */
const live = (): AbortSignal => new AbortController().signal;

function client() {
  return createWeChatTransport().createClient(CREDS);
}

describe("the WeChat request envelope", () => {
  it("authenticates every call the same way and identifies the client", async () => {
    await withFetch(defaults, async (calls) => {
      await client().checkCredentials();
      const call = calls[0]!;
      expect(call.url).toBe(`${WECHAT_API_BASE}/ilink/bot/getconfig`);
      expect(call.method).toBe("POST");
      expect(call.headers.get("authorization")).toBe(`Bearer ${CREDS.botToken}`);
      // The protocol's own auth-scheme name, not a bearer convention this server invented.
      expect(call.headers.get("authorizationtype")).toBe("ilink_bot_token");
      expect(call.headers.get("ilink-app-id")).toBe("bot");
      // A fresh random uint32, base64 of its decimal digits — present and decodable.
      const uin = call.headers.get("x-wechat-uin");
      expect(uin).not.toBeNull();
      expect(Buffer.from(uin!, "base64").toString("utf8")).toMatch(/^\d+$/);
      // The probe is `getconfig`, which reads: polling would advance the cursor the poll
      // loop is about to read, and a probe that eats a message is not a probe.
      expect(JSON.parse(call.body)).toMatchObject({ ilink_user_id: USER });
      expect(JSON.parse(call.body).base_info.bot_agent).toContain("PenguinHarness");
    });
  });

  it("raises the platform's own failure code, and never the credential with it", async () => {
    await withFetch(
      () => jsonResponse({ ret: -14, errmsg: "session timeout" }),
      async () => {
        const err = await client()
          .checkCredentials()
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(WeChatApiError);
        expect((err as WeChatApiError).ret).toBe(-14);
        expect((err as Error).message).toContain("session timeout");
        expect((err as Error).message).not.toContain(CREDS.botToken);
      },
    );
  });

  it("carries an HTTP failure's body through, which is what tells a revoked token from a wrong host", async () => {
    await withFetch(
      () => new Response("invalid bot token", { status: 401 }),
      async () => {
        const err = await client()
          .checkCredentials()
          .catch((e: unknown) => e);
        expect((err as Error).message).toContain("401");
        expect((err as Error).message).toContain("invalid bot token");
      },
    );
  });

  it("refuses to probe a binding with no scanned user identity rather than sending a blank one", async () => {
    await withFetch(defaults, async (calls) => {
      const bare = createWeChatTransport().createClient({ ...CREDS, userId: "" });
      await expect(bare.checkCredentials()).rejects.toThrow(/scanned user identity/);
      expect(calls).toHaveLength(0);
    });
  });
});

describe("the long poll", () => {
  const textMessage = (id: number, text: string) => ({
    message_id: id,
    from_user_id: USER,
    message_type: 1,
    context_token: "ctx-1",
    item_list: [{ type: 1, text_item: { text } }],
  });

  it("sends the cursor it was given and reports the one it got back", async () => {
    await withFetch(
      (call) =>
        call.url.endsWith("/getupdates")
          ? jsonResponse({ msgs: [textMessage(7, "hello")], get_updates_buf: "cursor-2" })
          : null,
      async (calls) => {
        const res = await client().getUpdates({ cursor: "cursor-1", signal: live() });
        expect(JSON.parse(calls[0]!.body).get_updates_buf).toBe("cursor-1");
        expect(res.cursor).toBe("cursor-2");
        expect(res.messages).toEqual([
          {
            userId: USER,
            messageId: "7",
            text: "hello",
            contextToken: "ctx-1",
            images: [],
            files: [],
          },
        ]);
      },
    );
  });

  it("keeps the old cursor when the response carries none, rather than starting over", async () => {
    // An empty `get_updates_buf` means "from the beginning" on the next call, which would
    // replay everything this poll just consumed.
    await withFetch(
      () => jsonResponse({ msgs: [] }),
      async () => {
        const res = await client().getUpdates({ cursor: "cursor-9", signal: live() });
        expect(res.cursor).toBe("cursor-9");
      },
    );
  });
});

describe("inbound normalization", () => {
  it("drops this bot's own messages, which the stream also carries", async () => {
    // Relaying them would answer every reply with another reply.
    expect(
      normalizeWeChatMessage({
        message_id: 1,
        from_user_id: USER,
        message_type: 2,
        item_list: [{ type: 1, text_item: { text: "a reply this bot sent" } }],
      }),
    ).toBeNull();
  });

  it("reads a voice message's own transcription as the message's text", async () => {
    // There is no audio on the connector seam, and WeChat has already done the transcription:
    // dropping it would answer a spoken question with the not-supported notice.
    const evt = normalizeWeChatMessage({
      message_id: 2,
      from_user_id: USER,
      message_type: 1,
      item_list: [
        { type: 3, voice_item: { media: { full_url: "https://cdn/v" }, text: "read this back" } },
      ],
    });
    expect(evt?.text).toBe("read this back");
    // The recording itself is not carried anywhere: it is not a file, and nothing decodes it.
    expect(evt?.files).toEqual([]);
  });

  it("carries a recording with no transcription as nothing at all", async () => {
    const evt = normalizeWeChatMessage({
      message_id: 3,
      from_user_id: USER,
      message_type: 1,
      item_list: [{ type: 3, voice_item: { media: { full_url: "https://cdn/v" } } }],
    });
    expect(evt?.text).toBe("");
    expect(evt?.images).toEqual([]);
    expect(evt?.files).toEqual([]);
  });

  it("puts a quoted message in front of the reply that answers it", async () => {
    // A reply rarely repeats what it is answering, and the model would otherwise read a
    // bare "yes".
    const evt = normalizeWeChatMessage({
      message_id: 4,
      from_user_id: USER,
      message_type: 1,
      item_list: [
        {
          type: 1,
          text_item: { text: "yes, do that" },
          ref_msg: {
            title: "Ada",
            message_item: { type: 1, text_item: { text: "shall I deploy?" } },
          },
        },
      ],
    });
    expect(evt?.text).toBe("[quote: Ada | shall I deploy?]\nyes, do that");
  });

  it("normalizes images, files and videos, preferring the hex key an image item carries", async () => {
    const hexKey = "00112233445566778899aabbccddeeff";
    const evt = normalizeWeChatMessage({
      message_id: 5,
      from_user_id: USER,
      message_type: 1,
      item_list: [
        {
          type: 2,
          // Both keys present: the item's own hex one wins, being the one the platform's
          // client prefers for images.
          image_item: {
            media: { full_url: "https://cdn/i", aes_key: "d3Jvbmcta2V5" },
            aeskey: hexKey,
          },
        },
        {
          type: 4,
          file_item: {
            media: { full_url: "https://cdn/f", aes_key: "a2V5" },
            file_name: "report.pdf",
          },
        },
        { type: 5, video_item: { media: { full_url: "https://cdn/v", aes_key: "a2V5" } } },
      ],
    });
    expect(evt?.images).toEqual([
      { url: "https://cdn/i", aesKey: Buffer.from(hexKey, "hex").toString("base64") },
    ]);
    expect(evt?.files).toEqual([
      { fileName: "report.pdf", media: { url: "https://cdn/f", aesKey: "a2V5" } },
      // The wire names no file for a video, and `.mp4` is the platform's own answer rather
      // than a guessed extension.
      { fileName: WECHAT_VIDEO_FILE_NAME, media: { url: "https://cdn/v", aesKey: "a2V5" } },
    ]);
  });

  it("names an unnamed file plainly rather than inventing an extension for it", async () => {
    const evt = normalizeWeChatMessage({
      message_id: 6,
      from_user_id: USER,
      message_type: 1,
      item_list: [{ type: 4, file_item: { media: { full_url: "https://cdn/f" } } }],
    });
    expect(evt?.files[0]!.fileName).toBe("file");
  });

  it("skips a media item with no URL rather than minting a handle that cannot be fetched", async () => {
    const evt = normalizeWeChatMessage({
      message_id: 7,
      from_user_id: USER,
      message_type: 1,
      item_list: [{ type: 2, image_item: { media: {} } }],
    });
    expect(evt?.images).toEqual([]);
  });
});

describe("outbound sends", () => {
  it("sends one item per request and echoes the conversation token", async () => {
    await withFetch(defaults, async (calls) => {
      await client().sendText({ userId: USER, text: "hi", contextToken: "ctx-7" });
      const body = JSON.parse(calls[0]!.body);
      expect(calls[0]!.url).toBe(`${WECHAT_API_BASE}/ilink/bot/sendmessage`);
      expect(body.msg.to_user_id).toBe(USER);
      expect(body.msg.context_token).toBe("ctx-7");
      expect(body.msg.message_type).toBe(2);
      expect(body.msg.message_state).toBe(2);
      // Exactly one item: the platform does not take a two-item list.
      expect(body.msg.item_list).toEqual([{ type: 1, text_item: { text: "hi" } }]);
    });
  });

  it("omits the token entirely when none is known, rather than sending a blank one", async () => {
    await withFetch(defaults, async (calls) => {
      await client().sendText({ userId: USER, text: "hi" });
      expect("context_token" in JSON.parse(calls[0]!.body).msg).toBe(false);
    });
  });

  it("uploads an image as ciphertext under a fresh key, then references the CDN's handle", async () => {
    uploads = [];
    const plaintext = Buffer.from("PNG-ish bytes, long enough to need padding");
    await withFetch(
      (call) => {
        if (call.url.endsWith("/getuploadurl")) {
          return jsonResponse({ ret: 0, upload_full_url: "https://cdn.example/upload?sig=abc" });
        }
        if (call.url.startsWith("https://cdn.example/upload")) {
          return new Response(null, {
            status: 200,
            headers: { "x-encrypted-param": "dl-param-1" },
          });
        }
        return null;
      },
      async (calls) => {
        await client().sendImage({
          userId: USER,
          text: "",
          file: { fileName: "chart.png", data: plaintext },
        });
        const handle = JSON.parse(calls[0]!.body);
        expect(handle.media_type).toBe(1);
        expect(handle.to_user_id).toBe(USER);
        expect(handle.rawsize).toBe(plaintext.length);
        expect(handle.rawfilemd5).toBe(createHash("md5").update(plaintext).digest("hex"));
        // PKCS#7 pads to the next full block, always adding at least one byte.
        expect(handle.filesize).toBe(Math.ceil((plaintext.length + 1) / 16) * 16);
        // Nothing here has a thumbnail to make, and the platform only demands sizes for one
        // that is being uploaded.
        expect(handle.no_need_thumb).toBe(true);

        // The bytes on the wire are ciphertext, and the key the handle declared opens them:
        // this is the pairing that fails silently if either half drifts.
        const key = Buffer.from(handle.aeskey as string, "hex");
        expect(key).toHaveLength(16);
        const decipher = createDecipheriv("aes-128-ecb", key, null);
        const round = Buffer.concat([decipher.update(uploads[0]!), decipher.final()]);
        expect(round.equals(plaintext)).toBe(true);
        expect(uploads[0]!.equals(plaintext)).toBe(false);

        const item = JSON.parse(calls[2]!.body).msg.item_list[0];
        expect(item.type).toBe(2);
        expect(item.image_item.media.encrypt_query_param).toBe("dl-param-1");
        expect(Buffer.from(item.image_item.media.aes_key as string, "base64").equals(key)).toBe(
          true,
        );
      },
    );
  });

  it("sends a file under the FILE media type, with its name and its PLAINTEXT length", async () => {
    uploads = [];
    const bytes = Buffer.from("%PDF-1.7 ...");
    await withFetch(
      (call) => {
        if (call.url.endsWith("/getuploadurl")) {
          return jsonResponse({ upload_full_url: "https://cdn.example/upload" });
        }
        if (call.url.startsWith("https://cdn.example/upload")) {
          return new Response(null, { status: 200, headers: { "x-encrypted-param": "dl-2" } });
        }
        return null;
      },
      async (calls) => {
        await client().sendFile({
          userId: USER,
          text: "",
          file: { fileName: "report.pdf", data: bytes },
        });
        expect(JSON.parse(calls[0]!.body).media_type).toBe(3);
        const item = JSON.parse(calls[2]!.body).msg.item_list[0];
        expect(item.type).toBe(4);
        expect(item.file_item.file_name).toBe("report.pdf");
        // The receiving client shows this number, and the ciphertext is a padding block
        // longer than what the reader actually gets.
        expect(item.file_item.len).toBe(String(bytes.length));
      },
    );
  });

  it("sends a caption as its own message ahead of the picture", async () => {
    uploads = [];
    await withFetch(
      (call) => {
        if (call.url.endsWith("/getuploadurl")) {
          return jsonResponse({ upload_full_url: "https://cdn.example/upload" });
        }
        if (call.url.startsWith("https://cdn.example/upload")) {
          return new Response(null, { status: 200, headers: { "x-encrypted-param": "dl-3" } });
        }
        return null;
      },
      async (calls) => {
        await client().sendImage({
          userId: USER,
          text: "here is the chart",
          file: { fileName: "c.png", data: Buffer.from("x") },
        });
        // upload handle, CDN, caption, picture — the caption is a message of its own because
        // one request carries one item.
        expect(calls).toHaveLength(4);
        expect(JSON.parse(calls[2]!.body).msg.item_list[0].text_item.text).toBe(
          "here is the chart",
        );
        expect(JSON.parse(calls[3]!.body).msg.item_list[0].type).toBe(2);
      },
    );
  });

  it("fails readably when the platform returns no upload URL, rather than guessing a CDN host", async () => {
    await withFetch(
      (call) => (call.url.endsWith("/getuploadurl") ? jsonResponse({ ret: 0 }) : null),
      async () => {
        await expect(
          client().sendFile({
            userId: USER,
            text: "",
            file: { fileName: "a.bin", data: Buffer.from("x") },
          }),
        ).rejects.toThrow(/upload URL was not returned/);
      },
    );
  });
});

describe("inbound media transfers", () => {
  const KEY = randomBytes(16);
  const PLAIN = Buffer.from("a picture's worth of bytes, padded on the way out");

  /** The ciphertext the CDN would serve for PLAIN under KEY. */
  function encrypted(): Buffer {
    const cipher = createCipheriv("aes-128-ecb", KEY, null);
    return Buffer.concat([cipher.update(PLAIN), cipher.final()]);
  }

  it("decrypts a download whose key arrived as raw base64", async () => {
    await withFetch(
      () => new Response(encrypted(), { status: 200 }),
      async () => {
        const bytes = await client().fetchMedia(
          { url: "https://cdn/i?sig=secret", aesKey: KEY.toString("base64") },
          1_000_000,
          "The image",
        );
        expect(bytes.equals(PLAIN)).toBe(true);
      },
    );
  });

  it("decrypts one whose key arrived as base64 of its hex digits, which files and videos send", async () => {
    await withFetch(
      () => new Response(encrypted(), { status: 200 }),
      async () => {
        const bytes = await client().fetchMedia(
          {
            url: "https://cdn/f",
            aesKey: Buffer.from(KEY.toString("hex"), "utf8").toString("base64"),
          },
          1_000_000,
          "The file",
        );
        expect(bytes.equals(PLAIN)).toBe(true);
      },
    );
  });

  it("passes an unencrypted download through untouched", async () => {
    await withFetch(
      () => new Response(PLAIN, { status: 200 }),
      async () => {
        const bytes = await client().fetchMedia({ url: "https://cdn/i" }, 1_000_000, "The image");
        expect(bytes.equals(PLAIN)).toBe(true);
      },
    );
  });

  it("refuses a transfer past the cap as a size problem, not a failure", async () => {
    await withFetch(
      () => new Response(Buffer.alloc(4096), { status: 200 }),
      async () => {
        const err = await client()
          .fetchMedia({ url: "https://cdn/i" }, 1024, "The image")
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(MessagingMediaTooLargeError);
      },
    );
  });

  it("never puts the signed CDN URL into a failure the chat will read", async () => {
    // The URL embeds the parameter that authorizes the read.
    await withFetch(
      () => new Response("nope", { status: 403 }),
      async () => {
        const err = await client()
          .fetchMedia({ url: "https://cdn/i?sig=SECRET-PARAM" }, 1_000_000, "The image")
          .catch((e: unknown) => e);
        expect((err as Error).message).toContain("The image");
        expect((err as Error).message).not.toContain("SECRET-PARAM");
      },
    );
  });

  it("reports a payload that will not decrypt as arrived-but-unreadable", async () => {
    await withFetch(
      () => new Response(Buffer.from("not a multiple of the block size at all"), { status: 200 }),
      async () => {
        const err = await client()
          .fetchMedia(
            { url: "https://cdn/i", aesKey: KEY.toString("base64") },
            1_000_000,
            "The image",
          )
          .catch((e: unknown) => e);
        expect((err as Error).message).toBe("The image arrived but could not be decrypted");
      },
    );
  });
});

describe("parseWeChatAesKey", () => {
  it("accepts both encodings the platform uses and rejects anything else", () => {
    const raw = randomBytes(16);
    expect(parseWeChatAesKey(raw.toString("base64")).equals(raw)).toBe(true);
    const hexEncoded = Buffer.from(raw.toString("hex"), "utf8").toString("base64");
    expect(parseWeChatAesKey(hexEncoded).equals(raw)).toBe(true);
    expect(() => parseWeChatAesKey(Buffer.from("short").toString("base64"))).toThrow();
  });
});
