/**
 * Kernel currency: everything that crosses a park/boot boundary is plain JSON.
 *
 * Context typing rides on arktype (see ./schema.ts): contexts are defined as
 * arktype types and wrapped with schema(); Json stays the wire-level currency
 * every parked document is made of.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

export function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
