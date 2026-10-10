/**
 * The budget box (features/company/budget-input.ts): a monthly cap stored in USD, typed and
 * shown in whichever currency the reader picked.
 *
 * - A USD box is stored as typed; a CNY box is divided by the fixed rate and rounded to cents.
 * - An empty box is unbounded, zero is a real budget, and a negative or non-number is refused.
 * - The box fills with the stored amount converted to the reader's currency (empty when there
 *   is no budget); a USD box round-trips exactly, and a CNY box shows what the cent-rounded
 *   amount really converts back to.
 * - The box accepts an empty value or a non-negative number, nothing else.
 * - The unit names the reader's currency, per month in the reader's language.
 */
import { describe, expect, it } from "vitest";
import {
  fromStoredUsd,
  isBudgetText,
  toStoredUsd,
  unitLabel,
} from "../src/features/company/budget-input";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

describe("toStoredUsd", () => {
  it("keeps a USD box as it was typed", () => {
    expect(toStoredUsd("100", "USD")).toBe(100);
    expect(toStoredUsd(" 12.5 ", "USD")).toBe(12.5);
  });

  it("divides a CNY box by the fixed rate and rounds to cents", () => {
    expect(toStoredUsd("700", "CNY")).toBe(100);
    expect(toStoredUsd("100", "CNY")).toBe(14.29);
  });

  it("reads an empty box as unbounded", () => {
    expect(toStoredUsd("", "USD")).toBeNull();
    expect(toStoredUsd("   ", "CNY")).toBeNull();
  });

  it("keeps zero as a real budget rather than unbounded", () => {
    expect(toStoredUsd("0", "USD")).toBe(0);
    expect(toStoredUsd("0", "CNY")).toBe(0);
  });

  it("refuses what is not a non-negative number (the callers validate first)", () => {
    expect(toStoredUsd("abc", "USD")).toBeNull();
    expect(toStoredUsd("-5", "USD")).toBeNull();
  });
});

describe("fromStoredUsd", () => {
  it("starts the box empty when there is no budget", () => {
    expect(fromStoredUsd(undefined, "USD")).toBe("");
    expect(fromStoredUsd(null, "CNY")).toBe("");
  });

  it("fills a USD box with the stored amount and a CNY box with the converted one", () => {
    expect(fromStoredUsd(100, "USD")).toBe("100");
    expect(fromStoredUsd(100, "CNY")).toBe("700");
    expect(fromStoredUsd(0, "USD")).toBe("0");
  });

  it("round-trips a USD box exactly", () => {
    for (const text of ["0", "30", "100", "12.5"]) {
      expect(fromStoredUsd(toStoredUsd(text, "USD"), "USD")).toBe(text);
    }
  });

  it("shows a CNY box what the cent-rounded amount actually converts back to", () => {
    // 100 CNY stores as $14.29, which is 100.03 CNY — the field says so under itself rather
    // than pretending the fixed rate is lossless.
    expect(fromStoredUsd(14.29, "CNY")).toBe("100.03");
  });
});

describe("isBudgetText", () => {
  it("accepts an empty box and any non-negative number", () => {
    expect(isBudgetText("")).toBe(true);
    expect(isBudgetText("  ")).toBe(true);
    expect(isBudgetText("0")).toBe(true);
    expect(isBudgetText("12.5")).toBe(true);
  });

  it("rejects a negative amount and anything that is not a number", () => {
    expect(isBudgetText("-1")).toBe(false);
    expect(isBudgetText("abc")).toBe(false);
    expect(isBudgetText("1,000")).toBe(false);
  });
});

describe("unitLabel", () => {
  it("names the reader's currency, per month in the reader's language", () => {
    expect(unitLabel("USD", en)).toMatch(/^\$/);
    expect(unitLabel("CNY", en)).toMatch(/^¥/);
    expect(unitLabel("USD", zh)).not.toBe(unitLabel("USD", en));
  });
});
