/**
 * Names Windows refuses for a file or a folder: a device name (`CON`, `PRN`, `AUX`, `NUL`,
 * `COM1`–`COM9`, `LPT1`–`LPT9`) in any letter case, alone or with an extension, and a name that
 * ends in a dot or a space. An id doubles as a directory name, so an Agent State holding one
 * cannot be copied onto a Windows disk.
 *
 * Checked only where an id is created — a Project, an Agent, a Skill or hook package, a
 * workbench — never where one is read: an id already on disk keeps opening on the systems that
 * allowed it, so a Linux or macOS server upgraded with an Agent named `aux` loses nothing.
 */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function isWindowsReservedName(name: string): boolean {
  return DEVICE_NAME.test(name) || /[. ]$/.test(name);
}

/** The rule in words, for the message that refuses a new id. */
export const WINDOWS_RESERVED_RULE =
  "Windows reserves it (con, prn, aux, nul, com1–com9 and lpt1–lpt9, with or without an extension, or a name ending in a dot)";
