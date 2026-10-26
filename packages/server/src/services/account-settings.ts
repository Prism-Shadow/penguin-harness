/**
 * The Settings pages' preferences as PUT /api/me/prefs accepts them: shape only.
 *
 * The values are the Web App's own vocabulary (a theme id, an accent preset, a font id), and the
 * Web App reads anything it does not know as that preference's default, so the server does not
 * keep a second copy of those lists to drift from the first. What it does hold the line on is the
 * shape — a short token, a boolean, the background's three fields — so the free-form document
 * cannot be used to store something else under a known name. `null` clears a preference.
 */
import { badRequest } from "../http/errors.js";
import type { BackgroundSettingsDto } from "../api/types.js";

/** Preferences whose value is one token of the Web App's vocabulary. */
const TOKEN_FIELDS = [
  "themeMode",
  "themeId",
  "accent",
  "textSize",
  "fontLatin",
  "fontCjk",
  "lang",
  "currency",
  "terminalTheme",
  "steerMode",
] as const;

/** Preferences that are a switch. */
const FLAG_FIELDS = ["toolAliases", "notifications", "launcherHidden"] as const;

const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
/** A background mode or position: lowercase words ("cover", "center top"). */
const BACKGROUND_WORDS = /^[a-z]+( [a-z]+)?$/;

/** The background settings as stored: exactly the three fields, the transparency clamped to 0–100. */
function parseBackground(raw: unknown): BackgroundSettingsDto {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw badRequest("background must be an object of transparency, mode and position, or null.");
  }
  const { transparency, mode, position } = raw as Record<string, unknown>;
  if (typeof transparency !== "number" || !Number.isFinite(transparency)) {
    throw badRequest("background.transparency must be a number from 0 to 100.");
  }
  if (typeof mode !== "string" || !BACKGROUND_WORDS.test(mode)) {
    throw badRequest("background.mode must be a lowercase word.");
  }
  if (typeof position !== "string" || !BACKGROUND_WORDS.test(position)) {
    throw badRequest("background.position must be one or two lowercase words.");
  }
  return { transparency: Math.min(100, Math.max(0, transparency)), mode, position };
}

/**
 * Validates (and normalizes, in place) the Settings-page preferences a prefs write carries; every
 * other key is left to the route. Throws before anything is stored.
 */
export function validateAccountSettings(body: Record<string, unknown>): void {
  for (const field of TOKEN_FIELDS) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !TOKEN.test(value)) {
      throw badRequest(`${field} must be a short token (letters, digits, - and _) or null.`);
    }
  }
  for (const field of FLAG_FIELDS) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "boolean") throw badRequest(`${field} must be a boolean or null.`);
  }
  if (body.background !== undefined && body.background !== null) {
    body.background = parseBackground(body.background);
  }
}
