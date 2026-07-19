/**
 * Unit tests for scrypt password hashing: format, verification, salt randomness,
 * and fallback behavior for invalid stored strings.
 */
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

describe("password", () => {
  it("散列格式为 scrypt$N$r$p$salt$hash 且可校验", async () => {
    const stored = await hashPassword("hello-world-123");
    const parts = stored.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(Number(parts[1])).toBeGreaterThan(0);
    await expect(verifyPassword("hello-world-123", stored)).resolves.toBe(true);
  });

  it("错误密码校验失败", async () => {
    const stored = await hashPassword("correct-password");
    await expect(verifyPassword("wrong-password", stored)).resolves.toBe(false);
  });

  it("同一密码两次散列结果不同（随机盐）", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    await expect(verifyPassword("same-password", a)).resolves.toBe(true);
    await expect(verifyPassword("same-password", b)).resolves.toBe(true);
  });

  it("非法存储串返回 false 而非抛异常", async () => {
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$a$b$c$d$e")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt$abc$8$1$!!$!!")).resolves.toBe(false);
  });
});
