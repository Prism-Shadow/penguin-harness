import { MIMEType } from "node:util";

/** Parse Content-Type with the platform parser; callers decide how to handle absence/invalidity. */
export function mediaType(header: string | undefined): MIMEType | null {
  if (header === undefined) return null;
  try {
    return new MIMEType(header);
  } catch {
    return null;
  }
}
