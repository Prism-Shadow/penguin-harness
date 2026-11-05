/**
 * e2e preferences helper. The Settings pages' preferences (theme, light or dark, language,
 * background…) belong to the account: a browser's localStorage only caches them for the first
 * frame, and at sign-in the account's copy replaces the cache. So a spec that wants a theme, a
 * language or a background sets it on the account — after logging the request context in, before
 * the page loads. Seeding localStorage instead is overwritten by the account's value, which is
 * whatever an earlier test of the same user left there.
 */
import { expect } from "@playwright/test";

const BASE = process.env.BASE_URL;

/** Writes preferences to the logged-in account (`ui_prefs`; `null` clears one back to its default). */
export async function setAccountPrefs(ctx, prefs) {
  const res = await ctx.put(`${BASE}/api/me/prefs`, { data: prefs });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Sets the account's background image (a PNG / JPEG / WebP data URL), or removes it with null. */
export async function setAccountBackgroundImage(ctx, image) {
  const res = await ctx.put(`${BASE}/api/me/background-image`, { data: { image } });
  expect(res.ok(), await res.text()).toBeTruthy();
}
