/**
 * The protocols the in-field protocol menu offers, in its order: five of MMSP's compatible
 * clients. The /models/detect probes try the first four in the same order.
 * MMSP is selected manually.
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
