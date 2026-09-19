import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { imagePng } from "./image-fixtures.js";

const pngBase64 = imagePng().toString("base64");

type FakeOutput = {
  mime?: string;
  data?: string;
};

async function runHelper({
  input = {
    model: "gemini-3.1-flash-image",
    prompt: "A small blue penguin",
    language: "en-US",
    assetKey: "cover",
  },
  outputs = [{ mime: "image/png", data: `Buffer.from(${JSON.stringify(pngBase64)}, "base64")` }],
  terminal = "stop",
  usage = true,
  providerError = false,
  existing,
  credential = "fake-test-only",
}: {
  input?: Record<string, unknown>;
  outputs?: FakeOutput[];
  terminal?: string;
  usage?: boolean;
  providerError?: boolean;
  existing?: Buffer;
  credential?: string;
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-image-test-"));
  await fs.copyFile(
    new URL(
      "../../../plugins/agent-development/skills/unified-llm-api/scripts/generate-image.mjs",
      import.meta.url,
    ),
    path.join(root, "generate-image.mjs"),
  );
  await fs.writeFile(path.join(root, "image-input.json"), JSON.stringify(input));
  if (existing) await fs.writeFile(path.join(root, "image.png"), existing);
  const module = path.join(root, "node_modules/@prismshadow/agenthub");
  await fs.mkdir(module, { recursive: true });
  await fs.writeFile(
    path.join(module, "package.json"),
    JSON.stringify({ type: "module", exports: "./index.js" }),
  );
  const outputSource = outputs
    .map(
      ({ mime = "image/png", data = `Buffer.from(${JSON.stringify(pngBase64)}, "base64")` }) =>
        `{type:"inline_data",mime_type:${JSON.stringify(mime)},data:${data}}`,
    )
    .join(",");
  await fs.writeFile(
    path.join(module, "index.js"),
    `import fs from "node:fs/promises";
export class AutoLLMClient {
  constructor(options) { this.options = options; }
  async *streamingResponse(options) {
    await fs.writeFile("request.json", JSON.stringify({client:this.options, request:options}));
    ${providerError ? 'throw new Error("secret-test-provider-header");' : ""}
    yield {content_items:[${outputSource}]};
    ${terminal === "missing" ? "" : `yield {content_items:[],finish_reason:${JSON.stringify(terminal)},usage_metadata:${usage ? "{}" : "null"}};`}
  }
}`,
  );
  const env = { ...process.env };
  if (credential === "") delete env.GEMINI_API_KEY;
  else env.GEMINI_API_KEY = credential;
  const processResult = spawnSync(process.execPath, ["generate-image.mjs"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 10000,
  });
  return { root, processResult };
}

describe("image generation helper", () => {
  it("uses the pinned model/config and writes one complete PNG", async () => {
    const { root, processResult } = await runHelper();
    try {
      expect(processResult.status, processResult.stderr).toBe(0);
      expect(await fs.readFile(path.join(root, "image.png"))).toEqual(
        Buffer.from(pngBase64, "base64"),
      );
      const request = JSON.parse(await fs.readFile(path.join(root, "request.json"), "utf8"));
      expect(request.client).toEqual({ model: "gemini-3.1-flash-image" });
      expect(request.request.config).toEqual({
        image_config: { aspect_ratio: "1:1", image_size: "1K" },
      });
      expect(request.request.messages[0].content_items[0].text).toContain("cover");
      expect(request.request.messages[0].content_items[0].text).toContain("A small blue penguin");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["length", false, true],
    ["missing", false, true],
    ["stop", true, true],
    ["stop", false, false],
  ])(
    "rejects incomplete or provider-error streams (%s)",
    async (terminal, providerError, usage) => {
      const { root, processResult } = await runHelper({ terminal, providerError, usage });
      try {
        expect(processResult.status).toBe(1);
        expect(processResult.stderr).not.toContain("secret-test-provider-header");
        await expect(fs.stat(path.join(root, "image.png"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["multiple images", [{ mime: "image/png" }, { mime: "image/png" }]],
    ["wrong MIME", [{ mime: "image/jpeg" }]],
    ["malformed PNG", [{ mime: "image/png", data: 'Buffer.from("not-a-png")' }]],
    [
      "truncated PNG",
      [
        {
          mime: "image/png",
          data: `Buffer.from(${JSON.stringify(pngBase64)}, "base64").subarray(0, 40)`,
        },
      ],
    ],
    [
      "bad chunk CRC",
      [
        {
          mime: "image/png",
          data: `Buffer.concat([Buffer.from(${JSON.stringify(pngBase64)}, "base64").subarray(0, -1), Buffer.from([1])])`,
        },
      ],
    ],
    [
      "zero dimensions",
      [{ mime: "image/png", data: `Buffer.from(${JSON.stringify(pngBase64)}, "base64")` }],
    ],
    [
      "oversized dimensions",
      [{ mime: "image/png", data: `Buffer.from(${JSON.stringify(pngBase64)}, "base64")` }],
    ],
  ])("rejects %s output", async (label, outputs) => {
    if (label === "zero dimensions" || label === "oversized dimensions") {
      const bytes = Buffer.from(pngBase64, "base64");
      bytes.writeUInt32BE(label === "zero dimensions" ? 0 : 4097, 16);
      outputs = [
        {
          mime: "image/png",
          data: `Buffer.from(${JSON.stringify(bytes.toString("base64"))}, "base64")`,
        },
      ];
    }
    const { root, processResult } = await runHelper({ outputs });
    try {
      expect(processResult.status).toBe(1);
      await expect(fs.stat(path.join(root, "image.png"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects oversized output", async () => {
    const { root, processResult } = await runHelper({
      outputs: [{ mime: "image/png", data: "Buffer.alloc(8 * 1024 * 1024 + 1)" }],
    });
    try {
      expect(processResult.status).toBe(1);
      await expect(fs.stat(path.join(root, "image.png"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("preserves existing output without another provider request", async () => {
    const { root, processResult } = await runHelper({ existing: Buffer.from("keep-me") });
    try {
      expect(processResult.status).toBe(1);
      expect(await fs.readFile(path.join(root, "image.png"))).toEqual(Buffer.from("keep-me"));
      await expect(fs.stat(path.join(root, "request.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [{ model: "other-model", prompt: "x", language: "en-US", assetKey: "cover" }],
    [{ model: "gemini-3.1-flash-image", prompt: "", language: "en-US", assetKey: "cover" }],
    [{ model: "gemini-3.1-flash-image", prompt: "x", language: "en-us", assetKey: "cover" }],
    [{ model: "gemini-3.1-flash-image", prompt: "x", language: "en-US", assetKey: "../cover" }],
  ])("fails preflight input validation without a provider request", async (input) => {
    const { root, processResult } = await runHelper({ input });
    try {
      expect(processResult.status).toBe(1);
      await expect(fs.stat(path.join(root, "request.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails without a credential and never emits the credential", async () => {
    const { root, processResult } = await runHelper({ credential: "" });
    try {
      expect(processResult.status).toBe(1);
      expect(processResult.stdout + processResult.stderr).not.toContain("fake-test-only");
      await expect(fs.stat(path.join(root, "request.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
