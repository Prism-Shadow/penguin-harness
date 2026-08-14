/**
 * Kernel currency: everything that crosses a park/boot boundary is plain JSON.
 *
 * TODO(schema): Json is deliberately crude. Once we adopt arktype (or similar),
 * context TS types will be derived from the iface schema and strict-parse /
 * defaults / migration checks move into the schema layer. The hand-written
 * Schema in ./schema.ts is shaped after that future so the swap stays local.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

export function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
