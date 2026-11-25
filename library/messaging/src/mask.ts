/**
 * API key masking: length <=12 -> `***`, otherwise `first4…last4`; plaintext is
 * never sent to the client. The 12-char threshold: `first4…last4` exposes 8
 * characters, which for a 9-12 character short secret would leak more than half of
 * it, so those are masked in full instead. Lives here because the messaging routes
 * mask a stored credential into its wire shape; the project-config service and the
 * plugin config page re-export it for their own callers.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return "***";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
