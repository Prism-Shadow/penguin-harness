/**
 * Pure logic for the model config dialog:
 * - Numeric input filtering: the context window field accepts digits only;
 *   the price field accepts digits and at most one decimal point (any other
 *   characters from paste/IME input are stripped and never reach the form);
 * - DTO -> row edit state (toRow): provider and modelId are both plain entry
 *   fields with no prefix parsing; the loaded identity (original) is a paired
 *   reference;
 * - Ownership of the default/vision-agent model pointers after save
 *   (nextPointers): always compared as pairs; renaming (either provider or
 *   model_id changes) moves the pointer along.
 */
import { describe, expect, it } from "vitest";
import {
  decimalOnly,
  digitsOnly,
  nextPointers,
  rowRef,
  toRow,
} from "../src/features/models/models-page";

describe("digitsOnly（上下文窗口）", () => {
  it("只留数字", () => {
    expect(digitsOnly("200000")).toBe("200000");
    expect(digitsOnly("20e5")).toBe("205");
    expect(digitsOnly("200,000 tokens")).toBe("200000");
    expect(digitsOnly("-3.5")).toBe("35");
    expect(digitsOnly("abc")).toBe("");
  });
});

describe("decimalOnly（价格）", () => {
  it("留数字与至多一个小数点", () => {
    expect(decimalOnly("3.75")).toBe("3.75");
    expect(decimalOnly("$3.75")).toBe("3.75");
    expect(decimalOnly("3.7.5")).toBe("3.75");
    expect(decimalOnly("1..2.3")).toBe("1.23");
    expect(decimalOnly(".5")).toBe(".5");
    expect(decimalOnly("-1e3")).toBe("13");
    expect(decimalOnly("abc")).toBe("");
  });
});

describe("toRow（DTO → 行编辑态）", () => {
  it("provider 与 modelId 都是条目字段（零拆解），载入身份为成对引用", () => {
    const row = toRow({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      isDefault: false,
    });
    expect(row.provider).toBe("anthropic");
    expect(row.modelId).toBe("claude-sonnet-4-6");
    expect(row.original).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
    expect(rowRef(row)).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
  });

  it("不在目录清单的 provider 原样保留（展示层才归 custom 桶）", () => {
    const row = toRow({ provider: "myproxy", modelId: "claude-sonnet-4-6", isDefault: false });
    expect(row.provider).toBe("myproxy");
    expect(row.modelId).toBe("claude-sonnet-4-6");
    expect(row.original).toEqual({ provider: "myproxy", modelId: "claude-sonnet-4-6" });
  });

  it("上游 id 自身可含 `/`（网关模型）：仍是完整的 model_id，不被误当分组", () => {
    const row = toRow({ provider: "openrouter", modelId: "xiaomi/mimo-v2.5", isDefault: false });
    expect(row.provider).toBe("openrouter");
    expect(row.modelId).toBe("xiaomi/mimo-v2.5");
  });
});

describe("nextPointers（保存后默认/视觉代理模型指向谁；一律成对）", () => {
  const mA = { provider: "custom", modelId: "m-a" };
  const mANew = { provider: "custom", modelId: "m-a-new" };
  const mB = { provider: "custom", modelId: "m-b" };
  const base = { action: "save" as const, defaultModel: mA, visionModel: mB };

  it("改名时指针跟着改名走（否则提交的旧引用已不在 models 内，服务端 400）", () => {
    // Renaming the current default model.
    expect(nextPointers({ ...base, editing: mA, ref: mANew })).toEqual({
      defaultModel: mANew,
      visionModel: mB,
    });
    // Renaming the current vision-agent model.
    const mBNew = { provider: "custom", modelId: "m-b-new" };
    expect(nextPointers({ ...base, editing: mB, ref: mBNew })).toEqual({
      defaultModel: mA,
      visionModel: mBNew,
    });
    // Same model is both default and vision agent: both pointers move together.
    expect(nextPointers({ ...base, editing: mA, ref: mANew, visionModel: mA })).toEqual({
      defaultModel: mANew,
      visionModel: mANew,
    });
  });

  it("只换分组（model_id 不变）同样是改名：指针跟着新 provider 走", () => {
    const moved = { provider: "openai", modelId: "m-a" };
    expect(nextPointers({ ...base, editing: mA, ref: moved })).toEqual({
      defaultModel: moved,
      visionModel: mB,
    });
  });

  it("不改名、改别的模型：指针原样不动", () => {
    expect(nextPointers({ ...base, editing: mA, ref: mA })).toEqual({
      defaultModel: mA,
      visionModel: mB,
    });
    const mC = { provider: "custom", modelId: "m-c" };
    const mCNew = { provider: "custom", modelId: "m-c-new" };
    expect(nextPointers({ ...base, editing: mC, ref: mCNew })).toEqual({
      defaultModel: mA,
      visionModel: mB,
    });
  });

  it("同名 model_id 双 provider 并存：只有成对相等的指针才跟随", () => {
    // Default pointer points to openai/m-a, but the edit renames custom/m-a:
    // same modelId, different provider — the pointer must not be changed.
    const openaiA = { provider: "openai", modelId: "m-a" };
    expect(
      nextPointers({
        action: "save",
        editing: mA,
        ref: mANew,
        defaultModel: openaiA,
        visionModel: undefined,
      }),
    ).toEqual({ defaultModel: openaiA, visionModel: undefined });
  });

  it("设为默认 / 设为视觉代理：指针指向本模型", () => {
    const mC = { provider: "custom", modelId: "m-c" };
    expect(nextPointers({ ...base, editing: mC, ref: mC, action: "setDefault" })).toEqual({
      defaultModel: mC,
      visionModel: mB,
    });
    expect(nextPointers({ ...base, editing: mC, ref: mC, action: "setVisionModel" })).toEqual({
      defaultModel: mA,
      visionModel: mC,
    });
  });

  it("新增的第一个模型（此前无默认）自动成为默认模型", () => {
    const first = { provider: "custom", modelId: "m-first" };
    expect(
      nextPointers({
        editing: null,
        ref: first,
        action: "save",
        defaultModel: undefined,
        visionModel: undefined,
      }),
    ).toEqual({ defaultModel: first, visionModel: undefined });
    // When a default already exists, a newly added model does not take it over.
    const mNew = { provider: "custom", modelId: "m-new" };
    expect(nextPointers({ ...base, editing: null, ref: mNew })).toEqual({
      defaultModel: mA,
      visionModel: mB,
    });
  });
});
