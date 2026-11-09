/**
 * The protocols the in-field protocol menu offers, in its order: five of MMSP's compatible
 * clients. The first three are the ones the /models/detect probes try, in the same order; the
 * Google GenAI (generateContent) and MMSP clients after them are picked by hand only, since a
 * probe could not tell them apart from an OpenAI-compatible endpoint cheaply and safely.
 *
 * The list sits in lib/ because both dictionaries name every entry (`models.protocolNames`); the
 * models feature re-exports it with the helpers around it (features/models/protocol-types.ts).
 */
export const PROTOCOL_CLIENT_TYPES = [
  "openai-responses",
  "ant-messages",
  "openai-chat",
  "google-genai",
  "mmsp",
] as const;
export type ProtocolClientType = (typeof PROTOCOL_CLIENT_TYPES)[number];
