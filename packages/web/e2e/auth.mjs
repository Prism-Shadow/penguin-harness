/**
 * e2e auth helper: with signup disabled, test users are always provisioned via
 * the built-in admin account, then logged in. The server seeds an admin
 * (admin / penguin-2026) on startup; a single e2e run shares one data root, and
 * provisioning is idempotent (reuses the user if it already exists) so a
 * single spec can be rerun on its own.
 */
import { request } from "@playwright/test";

const BASE = process.env.BASE_URL;
export const ADMIN_ID = "admin";
export const ADMIN_PASSWORD = "penguin-2026";

/** Log in: the cookie lands in the given request context (page.request is the browser context); returns user. */
export async function login(ctx, userId, password) {
  const res = await ctx.post(`${BASE}/api/auth/login`, { data: { userId, password } });
  if (!res.ok()) {
    throw new Error(`login ${userId} failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()).user;
}

/** Admin creates the user (409 is treated as already-exists, idempotent). */
export async function provisionUser(userId, password) {
  const adminCtx = await request.newContext();
  await login(adminCtx, ADMIN_ID, ADMIN_PASSWORD);
  const created = await adminCtx.post(`${BASE}/api/admin/users`, { data: { userId, password } });
  if (!created.ok() && created.status() !== 409) {
    throw new Error(`create user ${userId} failed: ${created.status()} ${await created.text()}`);
  }
  await adminCtx.dispose();
}

/** Provision the user and log ctx in as them; returns user. */
export async function provisionAndLogin(ctx, userId, password) {
  await provisionUser(userId, password);
  return login(ctx, userId, password);
}
