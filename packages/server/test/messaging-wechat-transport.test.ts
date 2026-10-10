/**
 * The WeChat production adapter — the half of the channel that talks to Tencent, under the
 * fake transport messaging-wechat.test.ts drives the connector with: the request envelope,
 * the long poll's cursor, the wire message reduced to the connector's event, and the CDN
 * media path (a pre-signed upload of AES-128-ECB ciphertext one way, a decrypt the other).
 *
 * - Every call is authenticated and identified the same way; a platform failure code or an
 *   HTTP failure's body is carried through, never with the credential in it.
 * - The credential probe passes on a good token whose ticket call has no conversation yet,
 *   fails on a refused or stale credential and on a request that never arrived, and never
 *   uses the update poll (which would eat a message).
 * - The long poll sends its cursor and reports the next one (keeping the old one when none
 *   comes back); a quiet window is an empty answer, while a transport fault and the caller's
 *   own abort are not.
 * - Inbound normalization drops this bot's own messages, reads a voice transcription as text,
 *   quotes what a reply answers, normalizes images, files and videos, names an unnamed file
 *   plainly and skips media with no URL.
 * - Outbound sends carry one item per request and the conversation token when known; an
 *   image or file is uploaded as ciphertext under a fresh key the handle declares, with the
 *   plaintext length, a caption goes out as its own message, and a missing upload URL fails
 *   readably.
 * - Every failure carries its verdict: a refusal behind an accepted credential, the session
 *   timeout (which still fails the probe), a request that never arrived and a 408, 429 or 5xx
 *   recover; a refused credential, a wrong host and an unreadable answer do not.
 * - Downloads decrypt under either key encoding, pass unencrypted bytes through, refuse a
 *   transfer past the cap as a size problem, keep the signed URL out of the failure, and
 *   report an undecryptable payload as such.
 *
 * Nothing here opens a socket: the global fetch is the suite's fetch fake, restored after
 * every case — a stub rather than a module mock, because this suite shares one module
 * registry across files and `vi.mock` would leak into every later one (see vitest.config.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { messagingErrorKind } from "../src/runtime/messaging/error-kind.js";
import { MessagingMediaTooLargeError } from "../src/runtime/messaging/media.js";
import type { WeChatCredentials } from "../src/runtime/messaging/wechat-api.js";
import {
  WECHAT_API_BASE,
  WECHAT_STALE_TOKEN_CODE,
  WECHAT_VIDEO_FILE_NAME,
  WeChatApiError,
  createWeChatTransport,
  normalizeWeChatMessage,
  parseWeChatAesKey,
} from "../src/runtime/messaging/wechat-api.js";
import { jsonResponse, stubFetch } from "./fixtures/fetch.js";
import type { FetchCall } from "./fixtures/fetch.js";

const CREDS: WeChatCredentials = {
  botId: "bot_9001",
  botToken: "wx-bot-token-ABCD-1234",
  baseUrl: WECHAT_API_BASE,
  userId: "ilink_user_aaa",
};

const USER = "ilink_user_aaa";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Stands the suite's fetch fake in for the global fetch: `answer` decides a call's response,
 * and returning null gives the default — an empty success, enough for the calls a test makes
 * on its way to the one it is about.
 */
function stubWeChat(
  answer: (call: FetchCall, index: number) => Response | null = () => null,
): FetchCall[] {
  return stubFetch((call, index) => answer(call, index) ?? jsonResponse({ ret: 0 })).calls;
}

/** The abort signal a poll takes; every test that is not about cancellation passes a live one. */
const live = (): AbortSignal => new AbortController().signal;

function client() {
  return createWeChatTransport().createClient(CREDS);
}

describe("the WeChat request envelope", () => {
  it("authenticates every call the same way and identifies the client", async () => {
    const calls = stubWeChat();
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

  it("raises the platform's own failure code, and never the credential with it", async () => {
    stubWeChat(() => jsonResponse({ ret: -14, errmsg: "session timeout" }));
    const err = await client()
      .checkCredentials()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WeChatApiError);
    expect((err as WeChatApiError).ret).toBe(-14);
    expect((err as Error).message).toContain("session timeout");
    expect((err as Error).message).not.toContain(CREDS.botToken);
  });

  it("carries an HTTP failure's body through, which is what tells a revoked token from a wrong host", async () => {
    stubWeChat(() => new Response("invalid bot token", { status: 401 }));
    const err = await client()
      .checkCredentials()
      .catch((e: unknown) => e);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).toContain("invalid bot token");
  });

  it("probes even without a scanned user identity: the auth layer is what it reads", async () => {
    // The user id belongs to the call BEHIND the credential, and that call's outcome is not
    // what this probe reports (see the credential-probe suite below).
    const calls = stubWeChat();
    const bare = createWeChatTransport().createClient({ ...CREDS, userId: "" });
    await expect(bare.checkCredentials()).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});

describe("the credential probe", () => {
  it("passes on a good token whose typing-ticket call has no conversation to work with", async () => {
    // The reported bug. `getconfig` mints a typing ticket for a CONVERSATION, so a bot nobody
    // has messaged yet answers this even though its token is fine and its sends work. Reading
    // that as a bad credential sent the user to re-scan a token that was never the problem.
    stubWeChat(() => jsonResponse({ ret: 1, errmsg: "GetTypingTicket rpc failed" }));
    await expect(client().checkCredentials()).resolves.toBeUndefined();
  });

  it("fails when the credential itself is refused", async () => {
    for (const status of [401, 403]) {
      stubWeChat(() => new Response("invalid bot token", { status }));
      const err = await client()
        .checkCredentials()
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WeChatApiError);
      expect((err as WeChatApiError).authenticated).toBe(false);
      expect((err as Error).message).toContain(String(status));
    }
  });

  it("fails on a stale token, which arrives as a business code rather than a status", async () => {
    // The one non-zero envelope code that IS about the credential: everything else means the
    // request got past it.
    stubWeChat(() => jsonResponse({ errcode: WECHAT_STALE_TOKEN_CODE, errmsg: "session timeout" }));
    const err = await client()
      .checkCredentials()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WeChatApiError);
    expect((err as WeChatApiError).authenticated).toBe(false);
  });

  it("fails when the request never arrived, which proves nothing either way", async () => {
    stubFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    await expect(client().checkCredentials()).rejects.toThrow(/ENOTFOUND/);
  });

  it("never probes with the update poll, which would eat a message", async () => {
    // `getupdates` would prove the credential too, and advance the cursor the connector is
    // about to read — so the messages it returned would be dropped and never delivered.
    const calls = stubWeChat();
    await client().checkCredentials();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/getconfig");
    expect(calls.some((c) => c.url.includes("getupdates"))).toBe(false);
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
    const calls = stubWeChat((call) =>
      call.url.endsWith("/getupdates")
        ? jsonResponse({ msgs: [textMessage(7, "hello")], get_updates_buf: "cursor-2" })
        : null,
    );
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
  });

  it("resolves a quiet window as empty rather than as an outage", async () => {
    // A long poll with nothing to report holds its request until the window closes. Treating
    // that as a failure would put the connection into `error` every quiet minute — and the
    // cursor is unchanged, so the next call simply asks again from where this one started.
    // The window closing, as fetch reports it — no real timer is waited on here.
    stubFetch(() => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      });
    });
    const res = await client().getUpdates({ cursor: "cursor-7", signal: live() });
    expect(res).toEqual({ messages: [], cursor: "cursor-7", timedOut: true });
  });

  it("still reports a transport fault, which is not a quiet window", async () => {
    stubFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    await expect(client().getUpdates({ cursor: "c", signal: live() })).rejects.toThrow(/ENOTFOUND/);
  });

  it("rethrows when the CALLER closed the connection, which is not a quiet window", async () => {
    // A disable aborts the same way a deadline does, and must reach the poll loop as the end
    // of the connection rather than as one more empty answer.
    const controller = new AbortController();
    stubFetch(() => {
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    await expect(client().getUpdates({ cursor: "c", signal: controller.signal })).rejects.toThrow();
  });

  it("keeps the old cursor when the response carries none, rather than starting over", async () => {
    // An empty `get_updates_buf` means "from the beginning" on the next call, which would
    // replay everything this poll just consumed.
    stubWeChat(() => jsonResponse({ msgs: [] }));
    const res = await client().getUpdates({ cursor: "cursor-9", signal: live() });
    expect(res.cursor).toBe("cursor-9");
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
    const calls = stubWeChat();
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

  it("omits the token entirely when none is known, rather than sending a blank one", async () => {
    const calls = stubWeChat();
    await client().sendText({ userId: USER, text: "hi" });
    expect("context_token" in JSON.parse(calls[0]!.body).msg).toBe(false);
  });

  it("uploads an image as ciphertext under a fresh key, then references the CDN's handle", async () => {
    const plaintext = Buffer.from("PNG-ish bytes, long enough to need padding");
    const calls = stubWeChat((call) => {
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
    });
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
    const round = Buffer.concat([decipher.update(calls[1]!.bytes), decipher.final()]);
    expect(round.equals(plaintext)).toBe(true);
    expect(Buffer.from(calls[1]!.bytes).equals(plaintext)).toBe(false);

    const item = JSON.parse(calls[2]!.body).msg.item_list[0];
    expect(item.type).toBe(2);
    expect(item.image_item.media.encrypt_query_param).toBe("dl-param-1");
    expect(Buffer.from(item.image_item.media.aes_key as string, "base64").equals(key)).toBe(true);
  });

  it("sends a file under the FILE media type, with its name and its PLAINTEXT length", async () => {
    const bytes = Buffer.from("%PDF-1.7 ...");
    const calls = stubWeChat((call) => {
      if (call.url.endsWith("/getuploadurl")) {
        return jsonResponse({ upload_full_url: "https://cdn.example/upload" });
      }
      if (call.url.startsWith("https://cdn.example/upload")) {
        return new Response(null, { status: 200, headers: { "x-encrypted-param": "dl-2" } });
      }
      return null;
    });
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
  });

  it("sends a caption as its own message ahead of the picture", async () => {
    const calls = stubWeChat((call) => {
      if (call.url.endsWith("/getuploadurl")) {
        return jsonResponse({ upload_full_url: "https://cdn.example/upload" });
      }
      if (call.url.startsWith("https://cdn.example/upload")) {
        return new Response(null, { status: 200, headers: { "x-encrypted-param": "dl-3" } });
      }
      return null;
    });
    await client().sendImage({
      userId: USER,
      text: "here is the chart",
      file: { fileName: "c.png", data: Buffer.from("x") },
    });
    // upload handle, CDN, caption, picture — the caption is a message of its own because
    // one request carries one item.
    expect(calls).toHaveLength(4);
    expect(JSON.parse(calls[2]!.body).msg.item_list[0].text_item.text).toBe("here is the chart");
    expect(JSON.parse(calls[3]!.body).msg.item_list[0].type).toBe(2);
  });

  it("fails readably when the platform returns no upload URL, rather than guessing a CDN host", async () => {
    stubWeChat((call) => (call.url.endsWith("/getuploadurl") ? jsonResponse({ ret: 0 }) : null));
    await expect(
      client().sendFile({
        userId: USER,
        text: "",
        file: { fileName: "a.bin", data: Buffer.from("x") },
      }),
    ).rejects.toThrow(/upload URL was not returned/);
  });
});

describe("the verdict a failure carries", () => {
  // What the error table files a connection failure or a send by: error-kind.ts reads
  // `recovers` at those two capture points and nothing else. Asserted where the adapter decides
  // it rather than on a hand-built error, which would only prove the classifier reads a boolean.
  const failureOf = async (
    answer: (call: FetchCall) => Response | null,
    run: () => Promise<unknown>,
  ): Promise<WeChatApiError> => {
    stubWeChat(answer);
    const caught = await run().then(
      () => null,
      (e: unknown) => e,
    );
    expect(caught).toBeInstanceOf(WeChatApiError);
    return caught as WeChatApiError;
  };
  const send = () => client().sendText({ userId: USER, text: "hi" });
  const probe = () => client().checkCredentials();

  it("recovers from a refusal the platform makes behind an accepted credential", async () => {
    // The reported row: the platform declined a send it had authenticated. Nothing on this
    // channel — no permission, no console setting — is anyone's to change, and the next send
    // goes through.
    const err = await failureOf(() => jsonResponse({ ret: -2, errmsg: "prepare failed" }), send);
    expect(err.message).toBe("wechat send failed: prepare failed");
    expect(err.authenticated).toBe(true);
    expect(err.recovers).toBe(true);
    expect(messagingErrorKind(err, "messaging_send_failed")).toBe("expected");
  });

  it("recovers from the session timeout, though the credential probe still fails on it", async () => {
    // The other reported row. The platform pauses the session; its own client waits and
    // resumes, never asking for a new scan — so the probe fails while it lasts, and the
    // outage it opens is routine.
    const err = await failureOf(
      () => jsonResponse({ ret: WECHAT_STALE_TOKEN_CODE, errmsg: "session timeout" }),
      probe,
    );
    expect(err.message).toBe("wechat credential check failed: session timeout");
    expect(err.authenticated).toBe(false);
    expect(err.recovers).toBe(true);
    expect(messagingErrorKind(err, "messaging_connect_failed")).toBe("expected");
  });

  it("recovers from a request that never arrived, and from a 408, a 429 or a 5xx", async () => {
    const unreachable = await failureOf(() => {
      throw new TypeError("fetch failed");
    }, send);
    expect(unreachable.recovers).toBe(true);
    // ...and says it never arrived, which is what the poll loop retries at once.
    expect(unreachable.network).toBe(true);
    for (const status of [408, 429, 500, 502, 503]) {
      const err = await failureOf(() => new Response("busy", { status }), send);
      expect(err.recovers).toBe(true);
      expect(err.network).toBe(false);
    }
  });

  it("does not recover from a refused credential, a wrong host or an unreadable answer", async () => {
    for (const status of [401, 403, 404]) {
      const err = await failureOf(() => new Response("invalid bot token", { status }), probe);
      expect(err.recovers).toBe(false);
      expect(messagingErrorKind(err, "messaging_connect_failed")).toBe("unexpected");
    }
    const garbled = await failureOf(() => new Response("<html>proxy</html>"), send);
    expect(garbled.recovers).toBe(false);
    expect(messagingErrorKind(garbled, "messaging_send_failed")).toBe("unexpected");
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
    stubWeChat(() => new Response(encrypted(), { status: 200 }));
    const bytes = await client().fetchMedia(
      { url: "https://cdn/i?sig=secret", aesKey: KEY.toString("base64") },
      1_000_000,
      "The image",
    );
    expect(bytes.equals(PLAIN)).toBe(true);
  });

  it("decrypts one whose key arrived as base64 of its hex digits, which files and videos send", async () => {
    stubWeChat(() => new Response(encrypted(), { status: 200 }));
    const bytes = await client().fetchMedia(
      {
        url: "https://cdn/f",
        aesKey: Buffer.from(KEY.toString("hex"), "utf8").toString("base64"),
      },
      1_000_000,
      "The file",
    );
    expect(bytes.equals(PLAIN)).toBe(true);
  });

  it("passes an unencrypted download through untouched", async () => {
    stubWeChat(() => new Response(PLAIN, { status: 200 }));
    const bytes = await client().fetchMedia({ url: "https://cdn/i" }, 1_000_000, "The image");
    expect(bytes.equals(PLAIN)).toBe(true);
  });

  it("refuses a transfer past the cap as a size problem, not a failure", async () => {
    stubWeChat(() => new Response(Buffer.alloc(4096), { status: 200 }));
    const err = await client()
      .fetchMedia({ url: "https://cdn/i" }, 1024, "The image")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MessagingMediaTooLargeError);
  });

  it("never puts the signed CDN URL into a failure the chat will read", async () => {
    // The URL embeds the parameter that authorizes the read.
    stubWeChat(() => new Response("nope", { status: 403 }));
    const err = await client()
      .fetchMedia({ url: "https://cdn/i?sig=SECRET-PARAM" }, 1_000_000, "The image")
      .catch((e: unknown) => e);
    expect((err as Error).message).toContain("The image");
    expect((err as Error).message).not.toContain("SECRET-PARAM");
  });

  it("reports a payload that will not decrypt as arrived-but-unreadable", async () => {
    stubWeChat(
      () => new Response(Buffer.from("not a multiple of the block size at all"), { status: 200 }),
    );
    const err = await client()
      .fetchMedia({ url: "https://cdn/i", aesKey: KEY.toString("base64") }, 1_000_000, "The image")
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe("The image arrived but could not be decrypted");
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
